import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAdapter } from "../core/registry.js";
import { browserFetchNote, jumboFetchSnippet } from "../adapters/cencosudBrowser.js";
import { toolError } from "../core/errors.js";

/**
 * Listas guardadas del usuario (fase 2). Como el token de Jumbo vive en el
 * localStorage del navegador, el cliente entrega el JSON crudo de las listas
 * (GET /lists y el detalle con items) en `rawLists`; el servidor solo
 * normaliza. Sin eso, explica cómo obtenerlo.
 */
export function registerGetSavedLists(server: McpServer): void {
  server.registerTool(
    "get_saved_lists",
    {
      title: "Listas guardadas del usuario",
      description:
        "Devuelve las listas de compra guardadas del usuario en la cadena, normalizadas a " +
        "{ id, name, items[] }. Requiere sesión: ejecuta el `browserSnippet` (GET /lists) en una pestaña " +
        "YA LOGUEADA de www.jumbo.cl y pásame el JSON en `rawLists`. Para el detalle con items, repite el " +
        "fetch a /lists/{scope}/{idList}. NO rasques el DOM ni React; es una llamada JSON directa. " +
        "El servidor nunca maneja credenciales.",
      inputSchema: {
        store: z.enum(["jumbo"]).default("jumbo").describe("Cadena. Fase 2: jumbo."),
        branchId: z
          .string()
          .optional()
          .describe('Sucursal de la sesión, ej. "jumboclj512".'),
        rawLists: z
          .unknown()
          .optional()
          .describe(
            "JSON crudo de las listas del usuario (una lista con items[], o un arreglo de listas) que obtuvo el navegador."
          ),
      },
    },
    async ({ store, branchId, rawLists }) => {
      if (rawLists === undefined) {
        const path = `/lists?store=${branchId ?? "{branchId}"}`;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  needsRawLists: true,
                  note: browserFetchNote("las listas guardadas del usuario"),
                  browserSnippet: jumboFetchSnippet(path),
                },
                null,
                2
              ),
            },
          ],
        };
      }
      try {
        const adapter = getAdapter(store);
        const lists = await adapter.getSavedLists({
          store,
          branchId,
          savedListsRaw: rawLists,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ store, count: lists.length, lists }, null, 2),
            },
          ],
        };
      } catch (err) {
        return toolError(
          err,
          `No se pudieron obtener las listas guardadas en ${store}`,
          store
        );
      }
    }
  );
}
