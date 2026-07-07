import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAdapter } from "../core/registry.js";
import { toolError } from "../core/errors.js";

export function registerGetOffers(server: McpServer): void {
  server.registerTool(
    "get_offers",
    {
      title: "Ofertas vigentes",
      description:
        "Lista las ofertas vigentes del supermercado (precio rebajado: `price` vigente vs `listPrice` normal). " +
        'Filtrable por categoría (ej. "Despensa", "Lácteos") y por sucursal (`branchId`). ' +
        "Con `primeOnly` devuelve las ofertas exclusivas para socios Jumbo Prime " +
        "(el monto exacto del precio socio se consulta con get_product).",
      inputSchema: {
        store: z
          .enum(["jumbo", "santaisabel"])
          .default("jumbo")
          .describe(
            "Cadena. jumbo (colecciones verificadas). santaisabel: aún sin colección de ofertas."
          ),
        category: z
          .string()
          .optional()
          .describe('Categoría para filtrar, ej. "Despensa". Omitir para todas.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .describe("Máximo de resultados (1-50)."),
        page: z.number().int().min(1).default(1).describe("Página de resultados."),
        branchId: z
          .string()
          .optional()
          .describe('Código de sucursal para precios locales, ej. "jumboclj512".'),
        primeOnly: z
          .boolean()
          .default(false)
          .describe("true = solo ofertas exclusivas de socios Jumbo Prime."),
      },
    },
    async ({ store, category, limit, page, branchId, primeOnly }) => {
      try {
        const adapter = getAdapter(store);
        const products = await adapter.getOffers({
          category,
          limit,
          page,
          branchId,
          primeOnly,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  store,
                  category: category ?? null,
                  primeOnly,
                  count: products.length,
                  products,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return toolError(err, `Error obteniendo ofertas de ${store}`, store);
      }
    }
  );
}
