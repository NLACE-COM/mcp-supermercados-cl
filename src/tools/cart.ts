import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  CART_BFF_BASE,
  buildCartPatchBody,
  parseCart,
} from "../adapters/cencosudCart.js";

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
        "Prepara agregar/actualizar productos en el carro de Jumbo del usuario. Como el servidor no maneja " +
        "credenciales, devuelve el request exacto a ejecutar por el navegador logueado " +
        "(PATCH /cart/items con su body) y, si el cliente ya lo ejecutó y entrega el JSON del carro en " +
        "`rawCartResult`, devuelve el carro normalizado (total, ahorro y ahorro Prime). Acción reversible " +
        "(se puede quitar del carro); no es una compra.",
      inputSchema: {
        store: z.enum(["jumbo"]).default("jumbo").describe("Cadena. Fase 3: jumbo."),
        branchId: z
          .string()
          .describe("Sucursal de la sesión, ej. \"jumboclj512\". Requerido."),
        items: z
          .array(
            z.object({
              skuId: z.string().describe("id del producto (skuId / data-cnstrc-item-id)"),
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
          "Ejecutar desde el navegador logueado del usuario (lleva sus headers de sesión: token, apiKey). " +
          "Devolver el JSON del carro en rawCartResult para obtener el carro normalizado.",
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
        "El servidor no ve credenciales: el navegador logueado obtiene el JSON con " +
        "GET /cart?store={branchId}&simulationTotals=true y lo entrega en `rawCart`. " +
        "Si no se entrega, se devuelve la instrucción de cómo obtenerlo.",
      inputSchema: {
        store: z.enum(["jumbo"]).default("jumbo").describe("Cadena. Fase 3: jumbo."),
        branchId: z.string().optional().describe("Sucursal, ej. \"jumboclj512\"."),
        rawCart: z
          .unknown()
          .optional()
          .describe("JSON crudo de GET /cart que obtuvo el navegador del usuario."),
      },
    },
    async ({ store, branchId, rawCart }) => {
      if (rawCart === undefined) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  needsRawCart: true,
                  request: {
                    method: "GET",
                    url: `${CART_BFF_BASE}/cart?store=${branchId ?? "{branchId}"}&simulationTotals=true`,
                    note: "Ejecutar desde el navegador logueado y pasar el JSON en rawCart.",
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
