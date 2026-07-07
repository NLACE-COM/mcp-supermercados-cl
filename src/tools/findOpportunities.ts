import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findOpportunities } from "../core/opportunities.js";
import { toolError } from "../core/errors.js";

/**
 * find_opportunities: las mejores oportunidades del momento (mayor descuento
 * + stock). Pensada para que el modelo recomiende aprovechar ofertas que el
 * usuario quizás no tiene en el carro. Pasar `excludeIds` con lo que ya tiene
 * (carro/frecuentes) para destacar solo lo nuevo.
 */
export function registerFindOpportunities(server: McpServer): void {
  server.registerTool(
    "find_opportunities",
    {
      title: "Oportunidades del momento",
      description:
        "Devuelve los productos con MAYOR descuento vigente y stock real, ordenados por porcentaje de descuento, " +
        "para recomendar aprovechar ofertas. Cada resultado trae `discountPct`, `saving` (ahorro CLP) y " +
        "`memberSaving` (ahorro extra socio Prime) además de nombre, precio, precio normal, unidad y foto. " +
        "Filtrable por `category` y `minDiscountPct`. Pasar `excludeIds` (ids del carro o frecuentes) para " +
        "destacar solo oportunidades que el usuario aún no tiene. `primeOnly` para ofertas exclusivas de socios. " +
        "Hoy disponible en Jumbo (colección de ofertas verificada).",
      inputSchema: {
        store: z
          .enum(["jumbo"])
          .default("jumbo")
          .describe("Cadena. Hoy: jumbo (con colección de ofertas)."),
        category: z
          .string()
          .optional()
          .describe('Categoría para acotar, ej. "Despensa", "Lácteos".'),
        minDiscountPct: z
          .number()
          .int()
          .min(0)
          .max(100)
          .default(0)
          .describe("Descuento mínimo en % para incluir (ej. 30 = solo 30%+ off)."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(15)
          .describe("Máximo de oportunidades a devolver."),
        branchId: z
          .string()
          .optional()
          .describe('Sucursal para precios/stock locales, ej. "jumboclj512".'),
        primeOnly: z
          .boolean()
          .default(false)
          .describe("true = solo ofertas exclusivas de socios Jumbo Prime."),
        excludeIds: z
          .array(z.string())
          .optional()
          .describe(
            "Ids de producto a excluir (lo que el usuario ya tiene en el carro o compra siempre)."
          ),
      },
    },
    async ({
      store,
      category,
      minDiscountPct,
      limit,
      branchId,
      primeOnly,
      excludeIds,
    }) => {
      try {
        const opportunities = await findOpportunities(store, {
          category,
          minDiscountPct,
          limit,
          branchId,
          primeOnly,
          excludeIds,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { store, count: opportunities.length, opportunities },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return toolError(
          err,
          `No se pudieron obtener oportunidades en ${store}`,
          store
        );
      }
    }
  );
}
