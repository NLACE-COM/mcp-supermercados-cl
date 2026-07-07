import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildList } from "../core/listBuilder.js";
import { getAdapter } from "../core/registry.js";

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
        "Nota fase 1: aún sin sesión, no prioriza los productos frecuentes del usuario (llega en fase 2); " +
        "si el usuario prefiere marcas específicas, incluirlas en el texto del ítem (ej. \"leche colun\").",
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
      },
    },
    async ({ store, items, branchId }) => {
      try {
        const adapter = getAdapter(store);
        const result = await buildList(adapter, items, { branchId });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  store,
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
