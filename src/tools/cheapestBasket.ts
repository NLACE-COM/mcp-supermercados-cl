import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { compareStores } from "../core/compare.js";
import { chooseCheapestBasket } from "../core/cheapestBasket.js";
import { toolError } from "../core/errors.js";
import { priceScopeInfo } from "../core/format.js";
import type { StoreId } from "../core/types.js";

/**
 * Arma la canasta más barata "repartida": por cada ítem elige la cadena donde
 * sale más barato y agrupa la compra por cadena. Reusa compare_stores (que ya
 * busca cada ítem en cada cadena) y post-procesa con chooseCheapestBasket.
 *
 * Por defecto compara las cadenas que responden desde el servidor (jumbo,
 * santaisabel, unimarc). Tottus/Lider bloquean el fetch directo: para incluirlas
 * hay que traer sus resultados por el puente de navegador (browserHtml de
 * search_products) y el modelo las integra al plan.
 */
const DEFAULT_STORES: StoreId[] = ["jumbo", "santaisabel", "unimarc"];

export function registerCheapestBasket(server: McpServer): void {
  server.registerTool(
    "build_cheapest_basket",
    {
      title: "Armar la canasta más barata (repartida por cadena)",
      description:
        "Toma una lista de ítems y, por CADA ítem, elige la cadena donde sale más barato " +
        "(por precio por unidad cuando todas lo informan), agrupando la compra por cadena " +
        "(la leche en una, el pan en otra). Devuelve `plan` por cadena, `picks` por ítem con " +
        "alternativas, `basketTotal` (comprando cada cosa donde es más barata), `singleStore` " +
        "y `splitSaving` (ahorro vs comprar todo en una sola cadena), y `missing`. Por defecto " +
        "compara jumbo, santaisabel y unimarc (las que responden desde el servidor); " +
        "tottus/lider requieren el puente de navegador (browserHtml de search_products). " +
        "NO agrega al carro: para eso usa add_to_cart (hoy solo Jumbo, con sesión); para el " +
        "resto quedan los links (`url`) de cada producto.",
      inputSchema: {
        items: z
          .array(z.string().min(1))
          .min(1)
          .max(30)
          .describe('Ítems en texto libre, ej. ["leche colun 1L", "pan de molde", "arroz 1kg"].'),
        stores: z
          .array(z.enum(["jumbo", "santaisabel", "unimarc", "tottus", "lider"]))
          .optional()
          .describe(
            "Cadenas a comparar. Por defecto jumbo, santaisabel y unimarc (tottus/lider bloquean el fetch del servidor)."
          ),
        branchId: z
          .string()
          .optional()
          .describe('Sucursal para precios locales de cadenas Cencosud, ej. "jumboclj512".'),
      },
    },
    async ({ items, stores, branchId }) => {
      try {
        const chosen: StoreId[] = stores && stores.length > 0 ? stores : DEFAULT_STORES;
        const cmp = await compareStores(items, chosen, branchId);
        const basket = chooseCheapestBasket(cmp);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  items,
                  ...priceScopeInfo(branchId),
                  ...basket,
                  storeErrors: cmp.stores
                    .filter((s) => s.error)
                    .map((s) => ({ store: s.store, error: s.error })),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return toolError(err, "Error armando la canasta más barata", undefined);
      }
    }
  );
}
