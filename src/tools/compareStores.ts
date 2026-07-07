import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { compareStores } from "../core/compare.js";
import { availableStores } from "../core/registry.js";
import { priceScopeInfo } from "../core/format.js";
import { progressNotifier } from "./progress.js";

/**
 * compare_stores (fase 7): capacidad secundaria del plan. Estima el total
 * de la misma lista en varias cadenas. El foco del producto sigue siendo la
 * profundidad en una cadena (build_list con sesión); esto es para el "de vez
 * en cuando".
 */
export function registerCompareStores(server: McpServer): void {
  server.registerTool(
    "compare_stores",
    {
      title: "Comparar cadenas",
      description:
        "Estima el total de una misma lista (ítems en texto libre) en varias cadenas chilenas y señala la más " +
        "barata entre las que tienen todos los productos. Devuelve por cadena el mejor match por ítem y el total. " +
        "IMPORTANTE: cada cadena resuelve el ítem por su cuenta, así que el 'más barato' puede ser un producto o " +
        "formato distinto; usa el campo `comparability` (same/similar/mixed por ítem) y compara por precio por " +
        "unidad, no solo por total. Capacidad secundaria: para el día a día conviene build_list con tu sesión. " +
        "Nota: unimarc/tottus/lider requieren IP residencial; si una cadena falla, se reporta y las demás siguen.",
      inputSchema: {
        items: z
          .array(z.string().min(1))
          .min(1)
          .max(20)
          .describe(
            'Lista de productos en texto libre, ej. ["leche", "arroz 1kg", "café"].'
          ),
        stores: z
          .array(z.enum(["jumbo", "santaisabel", "unimarc", "tottus", "lider"]))
          .optional()
          .describe("Cadenas a comparar. Por defecto, todas las disponibles."),
        branchId: z
          .string()
          .optional()
          .describe('Sucursal para las cadenas Cencosud (ej. "jumboclj512").'),
      },
    },
    async ({ items, stores, branchId }, extra) => {
      const target = stores && stores.length > 0 ? stores : availableStores();
      const result = await compareStores(
        items,
        target,
        branchId,
        progressNotifier(extra)
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                items: result.items,
                ...(branchId
                  ? {
                      priceScope: "sucursal" as const,
                      priceScopeNote:
                        "branchId aplica solo a las cadenas Cencosud (Jumbo/Santa Isabel); " +
                        "las demás cadenas usan su tienda por defecto.",
                    }
                  : priceScopeInfo(branchId)),
                cheapest: result.cheapest ?? null,
                disclaimer: result.disclaimer,
                comparability: result.comparability,
                stores: result.stores.map((s) => ({
                  store: s.store,
                  matched: `${s.matched}/${items.length}`,
                  total: s.total,
                  error: s.error ?? null,
                  items: s.items.map((i) => ({
                    query: i.query,
                    product: i.product
                      ? {
                          name: i.product.name,
                          brand: i.product.brand,
                          ean: i.product.ean,
                          price: i.product.price,
                          unitPrice: i.product.unitPrice,
                          unit: i.product.unit,
                        }
                      : null,
                  })),
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
