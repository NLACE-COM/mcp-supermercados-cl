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
    "super_eficiente",
    {
      title: "Armar el súper más barato (repartido por cadena)",
      description:
        "Por cada ítem elige la cadena más barata, arma el carro donde se puede (Jumbo) y " +
        "deja lista + links para el resto. Acepta lista pegada, Excel o audio (transcríbelo).",
      argsSchema: {
        items: z
          .string()
          .describe(
            "Ítems (uno por línea o separados por coma). También sirve pegar una lista/Excel " +
              "o transcribir un audio del usuario."
          ),
        presupuesto: z
          .string()
          .optional()
          .describe('Presupuesto máximo total en CLP, ej. "40000". Opcional.'),
        incluir_tottus_lider: z
          .enum(["si", "no"])
          .optional()
          .describe(
            '"si" para incluir Tottus/Lider vía navegador (más lento). Por defecto no.'
          ),
      },
    },
    ({ items, presupuesto, incluir_tottus_lider }) => {
      const budget = presupuesto
        ? ` Objetivo: no pasar de $${presupuesto} CLP en total; si te pasas, dime qué bajar.`
        : "";
      const extra =
        incluir_tottus_lider === "si"
          ? " Incluye también Tottus y Líder: para esas, con search_products usa el puente de " +
            "navegador (abre la búsqueda en el navegador, toma el __NEXT_DATA__ y pásalo como browserHtml), " +
            "y suma sus precios a la comparación por ítem."
          : "";
      return userMessage(
        `Arma mi súper de la forma MÁS BARATA repartiendo la compra entre cadenas. Ítems:\n${items}\n\n` +
          `Flujo:\n` +
          `1) Usa build_cheapest_basket con estos ítems (elige por ítem la cadena más barata por precio/unidad).${extra}\n` +
          `2) Ítems genéricos con varias versiones (ej. "leche"): si tengo sesión, mira mis frecuentes ` +
          `(get_frequent_purchases) para elegir lo que suelo comprar; si no, pregúntame la versión antes de decidir.\n` +
          `3) Arma el carro: para lo que quede más barato en Jumbo, agrégalo con add_to_cart (necesitas mi ` +
          `sucursal —usa discover_branch— y mi sesión; dame el browserSnippet a ejecutar). Para las otras cadenas ` +
          `no hay carro: déjame la lista con los links (url) de cada producto para agregar con un clic.${budget}\n` +
          `4) Mándame al final el resumen: qué comprar en cada cadena, subtotal por cadena, total de la canasta, ` +
          `cuánto ahorro vs comprar todo en una sola, y dónde quedó cada carro/lista. Avísame de los ítems en ` +
          `mixedFormatItems (formatos distintos) y de los que no se encontraron (missing).`
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
