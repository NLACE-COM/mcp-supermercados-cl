import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { dataSession } from "../adapters/session.js";
import { buildList, loadFrequent } from "../core/listBuilder.js";
import { getAdapter } from "../core/registry.js";
import { toolError } from "../core/errors.js";
import { formatClp, savingPct } from "../core/format.js";
import type { FrequentCard } from "../core/types.js";
import { progressNotifier } from "./progress.js";

export function registerBuildList(server: McpServer): void {
  server.registerTool(
    "build_list",
    {
      title: "Armar lista de compra",
      description:
        'Convierte una lista en lenguaje natural (ej. ["leche", "arroz 1kg", "café de grano"]) en productos ' +
        "concretos del catálogo, eligiendo por mejor precio por unidad y ofertas vigentes. Devuelve por ítem el " +
        "producto elegido, hasta 3 alternativas para ajustar, el ahorro por ofertas, y el total estimado en CLP. " +
        "Con `branchId` usa precios/stock de esa sucursal. " +
        "Si se entregan los productos frecuentes del usuario en `frequentCards` (desde get_frequent_purchases " +
        "con sesión iniciada), se priorizan: la lista se arma con lo que la persona realmente compra. " +
        'Si el usuario prefiere marcas específicas, incluirlas en el texto del ítem (ej. "leche colun").',
      inputSchema: {
        store: z
          .enum(["jumbo", "santaisabel", "unimarc", "tottus", "lider"])
          .default("jumbo")
          .describe("Cadena: jumbo, santaisabel, unimarc, tottus o lider."),
        items: z
          .array(z.string().min(1))
          .min(1)
          .max(30)
          .describe("Ítems de la lista en texto libre, uno por producto deseado."),
        branchId: z
          .string()
          .optional()
          .describe('Código de sucursal para precios locales, ej. "jumboclj512".'),
        onlyOffers: z
          .boolean()
          .default(false)
          .describe(
            "true = arma la lista solo con productos en oferta (con descuento)."
          ),
        onlyInStock: z
          .boolean()
          .default(false)
          .describe("true = solo productos con stock real."),
        maxBudget: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Presupuesto máximo en CLP. Si el total lo supera, baja a alternativas más baratas " +
              "(sin tocar tus frecuentes) y, si aún se pasa, sugiere qué quitar. No elimina ítems solo."
          ),
        frequentCards: z
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
            "Productos frecuentes del usuario (cards del DOM de la sesión) para priorizar lo que ya compra."
          ),
      },
    },
    async (
      { store, items, branchId, onlyOffers, onlyInStock, maxBudget, frequentCards },
      extra
    ) => {
      const notify = progressNotifier(extra);
      try {
        const adapter = getAdapter(store);
        const session = frequentCards?.length
          ? dataSession(store, {
              branchId,
              frequentCards: frequentCards as FrequentCard[],
            })
          : undefined;
        const frequentProducts = await loadFrequent(adapter, session);
        const result = await buildList(
          adapter,
          items,
          { branchId, frequentProducts, onlyOffers, onlyInStock, maxBudget },
          notify
        );
        const found = result.items.filter((i) => i.chosen).length;
        const onOffer = result.items.filter((i) => i.saving > 0).length;
        const summary = {
          totalFormatted: formatClp(result.total),
          savingFormatted: formatClp(result.totalSaving),
          savingPct: savingPct(result.totalSaving, result.total + result.totalSaving),
          itemsFound: found,
          itemsMissing: result.items.length - found,
          itemsOnOffer: onOffer,
          ...(result.budget
            ? {
                budget: formatClp(result.budget.max),
                overBudget: result.budget.overBudget,
                over: result.budget.overBudget
                  ? formatClp(result.budget.over)
                  : undefined,
              }
            : {}),
        };
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  store,
                  usedFrequent: frequentProducts.length > 0,
                  summary,
                  total: result.total,
                  totalSaving: result.totalSaving,
                  budget: result.budget,
                  items: result.items,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return toolError(err, `Error armando la lista en ${store}`, store);
      }
    }
  );
}
