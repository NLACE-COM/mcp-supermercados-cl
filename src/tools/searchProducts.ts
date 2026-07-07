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
        "Busca productos en el catálogo de un supermercado chileno y devuelve resultados normalizados. " +
        "Precios en CLP: `price` es el precio vigente (con oferta si la hay), `listPrice` el precio normal " +
        "cuando hay descuento, `unitPrice`/`unit` el precio por unidad base (kg/lt/un) para comparar formatos. " +
        "Con `branchId` (sucursal, ej. \"jumboclj512\") los precios y stock son los de esa tienda; " +
        "sin él, catálogo nacional. Para el precio socio (Prime) de un producto puntual, usar get_product.",
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
          .describe("Texto de búsqueda, ej. \"leche descremada\" o \"arroz grado 1\"."),
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
            "Código de sucursal para precios/stock locales, ej. \"jumboclj512\". Omitir para catálogo nacional."
          ),
      },
    },
    async ({ store, query, limit, page, branchId }) => {
      try {
        const adapter = getAdapter(store);
        const products = await adapter.searchProducts(query, {
          limit,
          page,
          branchId,
        });
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
