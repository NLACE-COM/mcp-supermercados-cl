import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  CART_BFF_BASE,
  buildCartPatchBody,
  parseCart,
} from "../adapters/cencosudCart.js";
import {
  browserFetchNote,
  jumboFetchSnippet,
  jumboMutateSnippet,
} from "../adapters/cencosudBrowser.js";

/**
 * Tools de carro (fase 3). El servidor MCP nunca ve el token de Jumbo (vive
 * en el navegador del usuario), así que no ejecuta las llamadas
 * autenticadas: para add_to_cart arma el request exacto que el cliente
 * (junto al navegador logueado) debe ejecutar, y normaliza el resultado si
 * el cliente lo devuelve. get_cart normaliza el JSON que el navegador ya
 * obtuvo de GET /cart.
 */
export function registerCartTools(server: McpServer): void {
  server.registerTool(
    "add_to_cart",
    {
      title: "Agregar al carro",
      description:
        "Agrega/actualiza productos en el carro de Jumbo del usuario. El servidor no maneja credenciales: " +
        "devuelve un `browserSnippet` (PATCH /cart/items con su body) para ejecutar en una pestaña YA LOGUEADA " +
        "de www.jumbo.cl. Si el navegador lo ejecutó y entregas el JSON del carro en `rawCartResult`, devuelvo " +
        "el carro normalizado (total, ahorro y ahorro Prime). Acción reversible (se puede quitar del carro); " +
        "no es una compra.",
      inputSchema: {
        store: z.enum(["jumbo"]).default("jumbo").describe("Cadena. Fase 3: jumbo."),
        branchId: z
          .string()
          .describe('Sucursal de la sesión, ej. "jumboclj512". Requerido.'),
        items: z
          .array(
            z.object({
              skuId: z
                .string()
                .describe(
                  "ID del ítem del carro: usa el campo `id` de search_products, no el campo `sku` (que es la referencia comercial)."
                ),
              quantity: z.number().int().positive(),
              measurementUnitUn: z.string().optional(),
              unitMultiplierUn: z.number().optional(),
              itemQuantityLimit: z.number().int().optional(),
              soldBy: z.string().optional(),
            })
          )
          .min(1)
          .max(50)
          .describe("Líneas a agregar/actualizar."),
        rawCartResult: z
          .unknown()
          .optional()
          .describe(
            "JSON de la respuesta del PATCH/GET /cart, si el navegador ya ejecutó el request. Se normaliza y devuelve."
          ),
      },
    },
    async ({ store, branchId, items, rawCartResult }) => {
      const body = buildCartPatchBody(items, branchId);
      const request = {
        method: "PATCH",
        url: `${CART_BFF_BASE}/cart/items`,
        body,
        note:
          browserFetchNote("el carro tras agregar los ítems") +
          " Devuelve el JSON del carro en rawCartResult para normalizarlo.",
        browserSnippet: jumboMutateSnippet("/cart/items", "PATCH", body, "cart"),
      };
      if (rawCartResult !== undefined) {
        const cart = parseCart(rawCartResult, store);
        return {
          content: [
            { type: "text", text: JSON.stringify({ executed: true, cart }, null, 2) },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ executed: false, request }, null, 2),
          },
        ],
      };
    }
  );

  server.registerTool(
    "get_cart",
    {
      title: "Estado del carro",
      description:
        "Normaliza el carro de Jumbo del usuario a { items, subTotal, total, savings, primeSavings }. " +
        "El servidor no ve credenciales. FLUJO RÁPIDO (una sola llamada): ejecuta el `browserSnippet` que " +
        "devuelve esta tool en una pestaña YA LOGUEADA de www.jumbo.cl y pásame el JSON en `rawCart`. " +
        "NO extraigas el estado de React ni el DOM del carro a mano: es lento, frágil e innecesario " +
        "(este fetch trae todo el carro directo). Si no pasas `rawCart`, devuelvo el snippet listo para ejecutar.",
      inputSchema: {
        store: z.enum(["jumbo"]).default("jumbo").describe("Cadena. Fase 3: jumbo."),
        branchId: z.string().optional().describe('Sucursal, ej. "jumboclj512".'),
        rawCart: z
          .unknown()
          .optional()
          .describe(
            "JSON crudo de GET /cart que obtuvo el navegador ejecutando el browserSnippet."
          ),
      },
    },
    async ({ store, branchId, rawCart }) => {
      if (rawCart === undefined) {
        const path = `/cart?store=${branchId ?? "{branchId}"}&simulationTotals=true`;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  needsRawCart: true,
                  note: browserFetchNote("el carro del usuario"),
                  browserSnippet: jumboFetchSnippet(path, "cart"),
                  request: {
                    method: "GET",
                    url: `${CART_BFF_BASE}${path}`,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      }
      const cart = parseCart(rawCart, store);
      return {
        content: [{ type: "text", text: JSON.stringify(cart, null, 2) }],
      };
    }
  );
}
