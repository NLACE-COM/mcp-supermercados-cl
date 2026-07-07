import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Prompts guiados: plantillas que el cliente MCP muestra como sugerencias
 * (ej. "/supermercados: armar_lista"). Suben la descubribilidad: el usuario no
 * tiene que saber qué tools existen ni cómo pedir las cosas. Cada prompt
 * devuelve un mensaje de usuario que orienta al modelo hacia el flujo correcto.
 */

const STORE_ARG = z
  .enum(["jumbo", "santaisabel", "unimarc", "tottus", "lider"])
  .optional()
  .describe("Cadena; por defecto jumbo.");

function userMessage(text: string) {
  return {
    messages: [
      {
        role: "user" as const,
        content: { type: "text" as const, text },
      },
    ],
  };
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "armar_lista",
    {
      title: "Armar mi lista de compra",
      description:
        "Convierte una lista en lenguaje natural en productos concretos, priorizando " +
        "tus frecuentes, precio por unidad y ofertas. Opcional: presupuesto máximo.",
      argsSchema: {
        items: z
          .string()
          .describe('Ítems separados por coma, ej. "leche, arroz 1kg, café".'),
        store: STORE_ARG,
        presupuesto: z
          .string()
          .optional()
          .describe('Presupuesto máximo en CLP, ej. "50000". Opcional.'),
      },
    },
    ({ items, store, presupuesto }) => {
      const chain = store ?? "jumbo";
      const budget = presupuesto
        ? ` No superes un presupuesto de $${presupuesto} CLP: si te pasas, avísame qué dejarías fuera.`
        : "";
      return userMessage(
        `Ármame la lista de compra en ${chain} con estos ítems: ${items}. ` +
          `Usa build_list priorizando ofertas y mejor precio por unidad.${budget} ` +
          `Si tengo sesión iniciada, prioriza mis productos frecuentes. ` +
          `Muéstrame el total y cuánto ahorro con las ofertas.`
      );
    }
  );

  server.registerPrompt(
    "conectar_sesion",
    {
      title: "Conectar mi cuenta (sesión)",
      description:
        "Guía para habilitar precios socio, frecuentes y carro sin entregar credenciales.",
      argsSchema: { store: STORE_ARG },
    },
    ({ store }) => {
      const chain = store ?? "jumbo";
      return userMessage(
        `Quiero habilitar mi sesión de ${chain} para ver precios socio, mis ` +
          `frecuentes y mi carro. Primero descubre mi sucursal (dame el ` +
          `browserSnippet para leerla del navegador), y luego explícame en pasos ` +
          `simples cómo entregar la sesión ejecutando los snippets en una pestaña ` +
          `ya logueada del sitio. No me pidas usuario ni contraseña.`
      );
    }
  );

  server.registerPrompt(
    "comparar_carro",
    {
      title: "Comparar mi carro entre cadenas",
      description:
        "Toma tu carro/lista y estima el total en varias cadenas, marcando la más barata.",
      argsSchema: {
        items: z
          .string()
          .optional()
          .describe("Ítems separados por coma; si tienes carro, se usa ese."),
      },
    },
    ({ items }) => {
      const base = items
        ? `Compara esta lista entre cadenas: ${items}.`
        : `Toma mi carro actual de Jumbo (get_cart) y compara esos ítems entre cadenas.`;
      return userMessage(
        `${base} Usa compare_stores. Ojo con el campo comparability: si un ítem ` +
          `queda "mixed" (formatos distintos), adviértemelo y compara por precio ` +
          `por unidad, no solo por total.`
      );
    }
  );

  server.registerPrompt(
    "ofertas_frecuentes",
    {
      title: "Ofertas de lo que suelo comprar",
      description:
        "Cruza tus productos frecuentes con las ofertas vigentes para destacar dónde conviene surtirse.",
      argsSchema: { store: STORE_ARG },
    },
    ({ store }) => {
      const chain = store ?? "jumbo";
      return userMessage(
        `Revisa mis productos frecuentes en ${chain} (get_frequent_purchases con ` +
          `mi sesión) y dime cuáles están en oferta ahora mismo, ordenados por el ` +
          `mayor descuento. Si no tengo sesión, guíame para conectarla.`
      );
    }
  );
}
