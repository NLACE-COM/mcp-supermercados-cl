import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jumboDiscoverBranchSnippet } from "../adapters/cencosudBrowser.js";

/**
 * Descubre la sucursal (branchId) del usuario sin pedirle el código técnico.
 * El servidor no ejecuta el navegador: devuelve un `browserSnippet` que el
 * cliente corre en una pestaña del sitio y que lee la sucursal elegida. Si el
 * cliente ya lo ejecutó, puede pasar el resultado en `discovered` para
 * confirmarlo.
 */
export function registerDiscoverBranch(server: McpServer): void {
  server.registerTool(
    "discover_branch",
    {
      title: "Descubrir mi sucursal",
      description:
        'Obtiene el código de sucursal (branchId, ej. "jumboclj512") leyéndolo del navegador, para no ' +
        "pedírselo al usuario. Devuelve un `browserSnippet` para ejecutar en www.jumbo.cl (con la comuna/tienda " +
        "ya elegida). El snippet retorna { found, branchId } o, si no hay tienda elegida, { found:false, hint }. " +
        "Pasa ese resultado en `discovered` para que la tool lo valide y te confirme el branchId a usar.",
      inputSchema: {
        store: z
          .enum(["jumbo", "santaisabel"])
          .default("jumbo")
          .describe("Cadena Cencosud. Por ahora jumbo/santaisabel."),
        discovered: z
          .unknown()
          .optional()
          .describe(
            "Resultado del browserSnippet, si el navegador ya lo ejecutó ({ found, branchId, ... })."
          ),
      },
    },
    async ({ store, discovered }) => {
      if (discovered === undefined) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  needsDiscovery: true,
                  note:
                    "Ejecuta browserSnippet en www.jumbo.cl (con tu comuna/tienda elegida) " +
                    "y pásame el resultado en `discovered`.",
                  browserSnippet: jumboDiscoverBranchSnippet(),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const result = discovered as {
        found?: boolean;
        branchId?: string;
        candidates?: string[];
        hint?: string;
      };
      if (result.found && result.branchId) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  store,
                  branchId: result.branchId,
                  candidates: result.candidates ?? [result.branchId],
                  note: "Usa este branchId en las demás tools para precios/stock locales.",
                },
                null,
                2
              ),
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                store,
                branchId: null,
                action:
                  result.hint ??
                  "No se encontró una sucursal. Pide al usuario que elija su comuna/tienda " +
                    "en jumbo.cl (modo de entrega) y vuelve a ejecutar el snippet.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
