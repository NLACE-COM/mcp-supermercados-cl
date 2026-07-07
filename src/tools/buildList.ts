import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { dataSession } from "../adapters/session.js";
import { buildList, loadFrequent } from "../core/listBuilder.js";
import { getAdapter } from "../core/registry.js";
import type { FrequentCard } from "../core/types.js";

export function registerBuildList(server: McpServer): void {
  server.registerTool(
    "build_list",
    {
      title: "Armar lista de compra",
      description:
        "Convierte una lista en lenguaje natural (ej. [\"leche\", \"arroz 1kg\", \"café de grano\"]) en productos " +
        "concretos del catálogo, eligiendo por mejor precio por unidad y ofertas vigentes. Devuelve por ítem el " +
        "producto elegido, hasta 3 alternativas para ajustar, el ahorro por ofertas, y el total estimado en CLP. " +
        "Con `branchId` usa precios/stock de esa sucursal. " +
        "Si se entregan los productos frecuentes del usuario en `frequentCards` (desde get_frequent_purchases " +
        "con sesión iniciada), se priorizan: la lista se arma con lo que la persona realmente compra. " +
        "Si el usuario prefiere marcas específicas, incluirlas en el texto del ítem (ej. \"leche colun\").",
      inputSchema: {
        store: z.enum(["jumbo"]).default("jumbo").describe("Cadena. Fase 1: jumbo."),
        items: z
          .array(z.string().min(1))
          .min(1)
          .max(30)
          .describe("Ítems de la lista en texto libre, uno por producto deseado."),
        branchId: z
          .string()
          .optional()
          .describe("Código de sucursal para precios locales, ej. \"jumboclj512\"."),
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
    async ({ store, items, branchId, frequentCards }) => {
      try {
        const adapter = getAdapter(store);
        const session = frequentCards?.length
          ? dataSession(store, {
              branchId,
              frequentCards: frequentCards as FrequentCard[],
            })
          : undefined;
        const frequentProducts = await loadFrequent(adapter, session);
        const result = await buildList(adapter, items, {
          branchId,
          frequentProducts,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  store,
                  usedFrequent: frequentProducts.length > 0,
                  total: result.total,
                  totalSaving: result.totalSaving,
                  items: result.items,
                },
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
            { type: "text", text: `Error armando la lista en ${store}: ${message}` },
          ],
        };
      }
    }
  );
}
