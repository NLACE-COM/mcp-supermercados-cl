import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAdapter } from "../core/registry.js";

export function registerGetProduct(server: McpServer): void {
  server.registerTool(
    "get_product",
    {
      title: "Detalle de producto",
      description:
        "Obtiene el detalle completo de un producto: precio vigente (`price`), precio normal (`listPrice`), " +
        "**precio socio Jumbo Prime (`memberPrice`)** cuando existe, precio por unidad (`unitPrice`/`unit`), " +
        "EAN, stock y oferta. Es la única fuente del precio socio en fase 1. " +
        "Acepta la URL del producto (campo `url` de search_products), el path o el slug.",
      inputSchema: {
        store: z
          .enum(["jumbo"])
          .default("jumbo")
          .describe("Cadena. Fase 1: jumbo."),
        idOrUrl: z
          .string()
          .min(1)
          .describe(
            "URL completa, path (\"/arroz-.../p\") o slug del producto. Usar el `url` devuelto por search_products."
          ),
      },
    },
    async ({ store, idOrUrl }) => {
      try {
        const adapter = getAdapter(store);
        const product = await adapter.getProduct(idOrUrl);
        if (!product) {
          return {
            content: [
              {
                type: "text",
                text: `No se encontró el producto "${idOrUrl}" en ${store}.`,
              },
            ],
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(product, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Error obteniendo "${idOrUrl}" en ${store}: ${message}`,
            },
          ],
        };
      }
    }
  );
}
