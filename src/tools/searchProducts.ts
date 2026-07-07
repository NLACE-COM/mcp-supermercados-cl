import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { availableStores, getAdapter } from "../core/registry.js";

/**
 * Tool de lectura de catálogo. Con sesión (fase 2) devolverá el precio
 * que le corresponde al usuario; hoy devuelve precio público + precio
 * lista, y memberPrice cuando la fuente lo expone sin login.
 */
export function registerSearchProducts(server: McpServer): void {
  server.registerTool(
    "search_products",
    {
      title: "Buscar productos",
      description:
        "Busca productos en el catálogo de un supermercado chileno y devuelve resultados enriquecidos: " +
        "`name`, `brand`, `description`, `imageUrl`, `url`. Precios en CLP: `price` es el precio vigente " +
        "(con oferta si la hay), `listPrice` el normal cuando hay descuento, `unitPrice`/`unit` el precio por " +
        "unidad base (kg/lt/un) para comparar formatos. Filtros opcionales: `maxPrice`/`minPrice` (CLP), " +
        "`inStockOnly`; orden con `sortBy` (price = más barato primero, unitPrice = mejor precio por kg/lt). " +
        "Con `branchId` (sucursal) los precios/stock son de esa tienda. Para el precio socio de un producto " +
        "puntual, usar get_product.",
      inputSchema: {
        store: z
          .enum(["jumbo", "santaisabel", "unimarc", "tottus", "lider"])
          .default("jumbo")
          .describe(
            "Cadena donde buscar: jumbo, santaisabel, unimarc, tottus o lider. " +
              "unimarc/tottus/lider requieren IP residencial (la máquina del usuario)."
          ),
        query: z
          .string()
          .min(1)
          .describe('Texto de búsqueda, ej. "leche descremada" o "arroz grado 1".'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe("Máximo de resultados (1-50)."),
        page: z.number().int().min(1).default(1).describe("Página de resultados."),
        branchId: z
          .string()
          .optional()
          .describe(
            'Código de sucursal para precios/stock locales, ej. "jumboclj512". Omitir para catálogo nacional.'
          ),
        maxPrice: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Filtra productos con precio vigente <= a este valor (CLP)."),
        minPrice: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Filtra productos con precio vigente >= a este valor (CLP)."),
        sortBy: z
          .enum(["relevance", "price", "unitPrice"])
          .default("relevance")
          .describe(
            "Orden: relevance (default), price (más barato primero) o unitPrice (mejor precio por kg/lt)."
          ),
        inStockOnly: z
          .boolean()
          .default(false)
          .describe("true = solo productos con stock real."),
      },
    },
    async ({
      store,
      query,
      limit,
      page,
      branchId,
      maxPrice,
      minPrice,
      sortBy,
      inStockOnly,
    }) => {
      try {
        const adapter = getAdapter(store);
        // Pedimos un poco más para que el filtro/orden tenga de dónde elegir.
        const raw = await adapter.searchProducts(query, {
          limit: maxPrice || minPrice || inStockOnly ? Math.min(50, limit * 3) : limit,
          page,
          branchId,
        });

        let products = raw;
        if (inStockOnly) products = products.filter((p) => p.inStock);
        if (maxPrice !== undefined)
          products = products.filter((p) => p.price <= maxPrice);
        if (minPrice !== undefined)
          products = products.filter((p) => p.price >= minPrice);
        if (sortBy === "price") {
          products = [...products].sort((a, b) => a.price - b.price);
        } else if (sortBy === "unitPrice") {
          products = [...products].sort(
            (a, b) => (a.unitPrice ?? a.price) - (b.unitPrice ?? b.price)
          );
        }
        products = products.slice(0, limit);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { store, query, count: products.length, products },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Error buscando "${query}" en ${store}: ${message}. Cadenas disponibles: ${availableStores().join(", ")}.`,
            },
          ],
        };
      }
    }
  );
}
