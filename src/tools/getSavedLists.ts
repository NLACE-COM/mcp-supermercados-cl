import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAdapter } from "../core/registry.js";

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
        "{ id, name, items[] }. Requiere sesión: el cliente entrega en `rawLists` el JSON que el navegador " +
        "logueado obtuvo del BFF (GET /lists y el detalle /lists/{scope}/{idList} con items). " +
        "El servidor nunca maneja credenciales.",
      inputSchema: {
        store: z.enum(["jumbo"]).default("jumbo").describe("Cadena. Fase 2: jumbo."),
        branchId: z
          .string()
          .optional()
          .describe("Sucursal de la sesión, ej. \"jumboclj512\"."),
        rawLists: z
          .unknown()
          .optional()
          .describe(
            "JSON crudo de las listas del usuario (una lista con items[], o un arreglo de listas) que obtuvo el navegador."
          ),
      },
    },
    async ({ store, branchId, rawLists }) => {
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
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `No se pudieron obtener las listas guardadas en ${store}: ${message}`,
            },
          ],
        };
      }
    }
  );
}
