import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { suggestSwaps } from "../core/listBuilder.js";
import { getAdapter } from "../core/registry.js";

export function registerSuggestSwaps(server: McpServer): void {
  server.registerTool(
    "suggest_swaps",
    {
      title: "Sugerir reemplazos convenientes",
      description:
        "Para cada ítem (nombre de producto o texto de búsqueda) sugiere reemplazos más convenientes dentro del " +
        "mismo catálogo: productos comparables con MEJOR precio por unidad (kg/lt/un) que el match actual. " +
        "Devuelve el producto actual, los reemplazos ordenados por ahorro por unidad, y el ahorro. " +
        "Útil después de build_list para optimizar la lista.",
      inputSchema: {
        store: z
          .enum(["jumbo", "santaisabel", "unimarc", "tottus", "lider"])
          .default("jumbo")
          .describe("Cadena: jumbo, santaisabel, unimarc, tottus o lider."),
        items: z
          .array(z.string().min(1))
          .min(1)
          .max(20)
          .describe(
            "Productos a optimizar, por nombre (ej. \"Arroz Grado 1 Tucapel 1 kg\") o búsqueda (\"arroz\")."
          ),
        branchId: z
          .string()
          .optional()
          .describe("Código de sucursal para precios locales, ej. \"jumboclj512\"."),
      },
    },
    async ({ store, items, branchId }) => {
      try {
        const adapter = getAdapter(store);
        const results = [];
        for (const item of items) {
          results.push(await suggestSwaps(adapter, item, { branchId }));
        }
        return {
          content: [
            { type: "text", text: JSON.stringify({ store, results }, null, 2) },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Error sugiriendo reemplazos en ${store}: ${message}`,
            },
          ],
        };
      }
    }
  );
}
