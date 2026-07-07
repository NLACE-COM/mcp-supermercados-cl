import { HttpStatusError } from "../http/client.js";
import type { StoreId } from "./types.js";

/**
 * Traduce un error crudo (de red, del sitio o de uso) a un mensaje accionable
 * para el usuario final: qué pasó y, sobre todo, qué hacer. El modelo lee el
 * campo `action` y se lo comunica al usuario en vez de mostrar un stack trace.
 */
export interface ActionableError {
  /** Categoría estable para que el modelo reaccione. */
  kind:
    | "session_expired"
    | "blocked"
    | "not_found"
    | "rate_limited"
    | "timeout"
    | "network"
    | "unknown";
  /** Qué pasó, en una frase. */
  message: string;
  /** Siguiente paso concreto para el usuario. */
  action: string;
}

/** Cadenas que exigen IP residencial (bloquean datacenter). */
const RESIDENTIAL_ONLY: StoreId[] = ["unimarc", "tottus", "lider"];

export function toActionableError(err: unknown, store?: StoreId): ActionableError {
  const raw = err instanceof Error ? err.message : String(err);
  const residentialHint =
    store && RESIDENTIAL_ONLY.includes(store)
      ? ` ${store} bloquea el tráfico de datacenter: corre el servidor en tu equipo (IP residencial).`
      : "";

  if (err instanceof HttpStatusError) {
    if (err.status === 401 || err.status === 403) {
      return {
        kind: "session_expired",
        message: `El sitio rechazó la petición (HTTP ${err.status}).`,
        action:
          "Tu sesión pudo expirar o falta. Abre el sitio en el navegador, verifica " +
          "que estás logueado, y vuelve a ejecutar el browserSnippet para reenviar la sesión." +
          residentialHint,
      };
    }
    if (err.status === 404) {
      return {
        kind: "not_found",
        message: `No se encontró el recurso (HTTP 404).`,
        action:
          "Revisa el identificador/slug del producto o la sucursal (branchId). " +
          "Si venía de una búsqueda, reintenta la búsqueda para tomar una URL fresca.",
      };
    }
    if (err.status === 429) {
      return {
        kind: "rate_limited",
        message: "El sitio pidió bajar el ritmo (HTTP 429).",
        action:
          "Espera unos segundos y reintenta; el cliente ya respeta un ritmo humano.",
      };
    }
    if (err.status >= 500) {
      return {
        kind: "unknown",
        message: `El sitio respondió con un error (HTTP ${err.status}).`,
        action: "Suele ser transitorio: reintenta en un momento o usa adapter_status.",
      };
    }
  }

  if (/timeout|timed out|aborted|AbortError/i.test(raw)) {
    return {
      kind: "timeout",
      message: "La petición tardó demasiado y se canceló.",
      action:
        "Reintenta; si persiste, la cadena puede estar lenta o bloqueando." +
        residentialHint,
    };
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|network/i.test(raw)) {
    return {
      kind: "network",
      message: "No se pudo conectar con el sitio.",
      action:
        "Revisa tu conexión y reintenta. Usa adapter_status para ver qué cadenas responden." +
        residentialHint,
    };
  }
  if (/bloque|blocked|perimeterx|captcha|forbidden/i.test(raw)) {
    return {
      kind: "blocked",
      message: "La cadena bloqueó la petición (antibot).",
      action:
        "Corre el servidor desde tu equipo (IP residencial), no desde la nube." +
        residentialHint,
    };
  }

  return {
    kind: "unknown",
    message: raw,
    action:
      "Reintenta; si persiste, revisa adapter_status o abre un issue con el detalle.",
  };
}

/** Arma el bloque `content` de error de una tool con mensaje accionable. */
export function toolError(err: unknown, context: string, store?: StoreId) {
  const actionable = toActionableError(err, store);
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: context, ...actionable }, null, 2),
      },
    ],
  };
}
