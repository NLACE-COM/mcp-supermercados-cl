import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { availableStores, getAdapter } from "../core/registry.js";
import { toActionableError, toolError } from "../core/errors.js";
import { priceScopeInfo } from "../core/format.js";
import { wrapLiderHtml } from "../adapters/lider.js";
import { wrapTottusHtml } from "../adapters/tottus.js";

/**
 * Cadenas SSR protegidas por antibot que aceptan un puente de navegador: la
 * tool recibe el HTML (o el JSON de __NEXT_DATA__) que el usuario obtuvo en su
 * navegador real y lo parsea, en vez de hacer el fetch que el sitio bloquea
 * por fingerprint del cliente.
 */
const BROWSER_BRIDGE: Partial<
  Record<
    string,
    { wrap: (html: string) => string; searchUrl: (query: string, page: number) => string }
  >
> = {
  lider: {
    wrap: wrapLiderHtml,
    searchUrl: (query, page) =>
      `https://super.lider.cl/search?query=${encodeURIComponent(query)}${page > 1 ? `&page=${page}` : ""}`,
  },
  tottus: {
    wrap: wrapTottusHtml,
    searchUrl: (query, page) =>
      `https://www.tottus.cl/tottus-cl/buscar?Ntt=${encodeURIComponent(query)}${page > 1 ? `&page=${page}&store=to_com` : ""}`,
  },
};

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
        browserHtml: z
          .string()
          .optional()
          .describe(
            "Líder y Tottus: HTML de la página de búsqueda (o el JSON de __NEXT_DATA__) " +
              "obtenido en un navegador real que ya pasó el antibot. Si se entrega, se " +
              "parsea eso en vez de hacer el fetch (que la cadena bloquea por fingerprint " +
              "del cliente). Flujo: llamar sin browserHtml → se devuelve openUrl+browserSnippet " +
              "→ ejecutarlo en el navegador → reintentar con browserHtml."
          ),
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
      browserHtml,
    }) => {
      // Cadenas SSR con antibot (Líder/Tottus): el fetch del servidor cae en el
      // bloqueo (fingerprint del cliente). Si el usuario trae el HTML desde un
      // navegador real que ya pasó el desafío, lo usamos vía el puente de sesión.
      const bridge = BROWSER_BRIDGE[store];
      try {
        const adapter = getAdapter(store);
        const session =
          bridge && browserHtml
            ? { store, fetchAuthedHtml: async () => bridge.wrap(browserHtml) }
            : undefined;
        // Pedimos un poco más para que el filtro/orden tenga de dónde elegir.
        const raw = await adapter.searchProducts(query, {
          limit: maxPrice || minPrice || inStockOnly ? Math.min(50, limit * 3) : limit,
          page,
          branchId,
          ...(session ? { session } : {}),
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
                {
                  store,
                  query,
                  ...priceScopeInfo(branchId),
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
        // Cadenas con puente de navegador (Líder/Tottus): si cayó en el antibot y
        // no nos pasaron el HTML del navegador, guiamos el puente en vez de solo
        // reportar el error. Ojo: el 403 de Tottus se clasifica como
        // "session_expired"; para búsqueda pública equivale a bloqueo.
        if (bridge && !browserHtml) {
          const kind = toActionableError(err, store).kind;
          if (kind === "blocked" || kind === "session_expired") {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      store,
                      query,
                      blocked: true,
                      note:
                        `${store} bloquea el fetch del servidor (antibot): no es tu IP, es el ` +
                        "fingerprint del cliente. Abre la búsqueda en un navegador real (que ya " +
                        "pasó el desafío) y reintenta pasando browserHtml.",
                      openUrl: bridge.searchUrl(query, page),
                      browserSnippet:
                        "document.getElementById('__NEXT_DATA__')?.textContent || document.documentElement.outerHTML",
                      retryWith: `Reintenta search_products con store='${store}', la misma query y browserHtml = lo que devolvió el snippet.`,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }
        }
        return toolError(
          err,
          `Error buscando "${query}" en ${store}. Cadenas disponibles: ${availableStores().join(", ")}`,
          store
        );
      }
    }
  );
}
