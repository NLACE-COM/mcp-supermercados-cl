import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAdapter } from "../core/registry.js";
import { dataSession } from "../adapters/session.js";
import { jumboFrequentCardsSnippet } from "../adapters/cencosudBrowser.js";
import { toolError } from "../core/errors.js";
import type { FrequentCard } from "../core/types.js";

/**
 * Productos frecuentes del usuario. Requiere material de sesión: como el
 * token de Jumbo vive en el localStorage del navegador, el cliente MCP (que
 * corre junto al navegador del usuario) entrega las cards ya extraídas del
 * DOM de /productos-frecuentes vía `cards`. Sin eso, la tool explica cómo
 * habilitarlo en vez de fallar en seco.
 */
export function registerGetFrequentPurchases(server: McpServer): void {
  server.registerTool(
    "get_frequent_purchases",
    {
      title: "Productos frecuentes del usuario",
      description:
        "Devuelve los productos que el usuario compra habitualmente en la cadena, normalizados con su precio " +
        "vigente, precio normal y **precio socio Jumbo Prime** cuando aplica. Base para armar la lista con lo " +
        "que la persona realmente compra. Requiere sesión: entrega en `cards` el resultado de ejecutar el " +
        "`browserSnippet` (una sola pasada al DOM) en www.jumbo.cl/productos-frecuentes ya logueado. NO rasques " +
        "el estado de React ni improvises selectores; usa el snippet. El servidor nunca maneja credenciales.",
      inputSchema: {
        store: z.enum(["jumbo"]).default("jumbo").describe("Cadena. Fase 2: jumbo."),
        branchId: z
          .string()
          .optional()
          .describe('Sucursal de la sesión, ej. "jumboclj512".'),
        cards: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              dataPrice: z.string().optional(),
              href: z.string().nullable().optional(),
              tachado: z.string().nullable().optional(),
              ppuNodes: z.array(z.string()).optional(),
              prime: z.string().nullable().optional(),
              innerText: z.string().optional(),
            })
          )
          .optional()
          .describe(
            "Cards de producto extraídas del DOM de /productos-frecuentes (data-cnstrc-item-* + textos de precio). " +
              "Las entrega el navegador ya logueado del usuario."
          ),
      },
    },
    async ({ store, branchId, cards }) => {
      if (!cards || cards.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  needsCards: true,
                  note:
                    "Ejecuta browserSnippet en www.jumbo.cl/productos-frecuentes ya logueado " +
                    "y pasa el arreglo resultante en `cards`. Es una sola pasada al DOM; " +
                    "no rasques React ni improvises selectores.",
                  browserSnippet: jumboFrequentCardsSnippet(),
                },
                null,
                2
              ),
            },
          ],
        };
      }
      try {
        const adapter = getAdapter(store);
        const session = dataSession(store, {
          branchId,
          frequentCards: cards as FrequentCard[] | undefined,
        });
        const products = await adapter.getFrequentPurchases(session);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { store, count: products.length, products },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return toolError(
          err,
          `No se pudieron obtener los productos frecuentes en ${store}`,
          store
        );
      }
    }
  );
}
