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
        "Para cada ítem (nombre de producto o texto de búsqueda) sugiere reemplazos convenientes dentro del " +
        "mismo catálogo. Por defecto: mejor precio por unidad (kg/lt/un) que el match actual. " +
        "Con `preferNatural: true` cambia el criterio a 'más natural manteniendo el precio': trae alternativas de " +
        "precio similar CON sus ingredientes y sellos nutricionales, para elegir la de lista de ingredientes más " +
        "corta/limpia sin subir el gasto (usa la ficha; hoy Jumbo y Santa Isabel). " +
        "Devuelve el producto actual y los reemplazos con su ahorro por unidad.",
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
            'Productos a optimizar, por nombre (ej. "Arroz Grado 1 Tucapel 1 kg") o búsqueda ("arroz").'
          ),
        branchId: z
          .string()
          .optional()
          .describe('Código de sucursal para precios locales, ej. "jumboclj512".'),
        preferNatural: z
          .boolean()
          .default(false)
          .describe(
            "true = prioriza alternativas más naturales (menos ingredientes) a precio similar, con ingredientes incluidos."
          ),
      },
    },
    async ({ store, items, branchId, preferNatural }) => {
      try {
        const adapter = getAdapter(store);
        const results = [];
        for (const item of items) {
          results.push(await suggestSwaps(adapter, item, { branchId, preferNatural }));
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
