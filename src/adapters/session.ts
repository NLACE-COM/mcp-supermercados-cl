import type { Session, StoreId } from "../core/types.js";

/**
 * Puente de sesión hacia el navegador del usuario.
 *
 * Regla del plan: el servidor MCP nunca ve ni pide credenciales. En Jumbo,
 * el token de sesión vive en el localStorage del sitio, así que no basta
 * exportar cookies: hay que operar el navegador ya logueado del usuario.
 *
 * Vía de producción (fase 2 completa): un proceso Playwright que reusa el
 * perfil de Chrome del usuario, navega a las páginas de cuenta y devuelve
 * su HTML/DOM autenticado. Ese proceso implementa `BrowserBridge` y se pasa
 * a `browserSession()`. Aquí se define el contrato y una sesión de datos
 * directa para pruebas y para puentes que ya extraen las cards.
 */
export interface BrowserBridge {
  /** Devuelve el HTML de una ruta del sitio, con la sesión del usuario. */
  fetchAuthedHtml(path: string): Promise<string>;
}

/** Sesión respaldada por un puente de navegador (Playwright, extensión…). */
export function browserSession(
  store: StoreId,
  bridge: BrowserBridge,
  opts: { branchId?: string } = {}
): Session {
  return {
    store,
    branchId: opts.branchId,
    fetchAuthedHtml: (path) => bridge.fetchAuthedHtml(path),
  };
}

/**
 * Sesión de datos directa: el puente ya extrajo las cards de productos del
 * DOM (camino preferido cuando el navegador puede correr JS, evita parsear
 * HTML). Útil también en tests.
 */
export function dataSession(
  store: StoreId,
  data: { branchId?: string; frequentCards?: Session["frequentCards"] }
): Session {
  return {
    store,
    branchId: data.branchId,
    frequentCards: data.frequentCards,
  };
}
