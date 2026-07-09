import type { Session, StoreId } from "../core/types.js";
import { PlaywrightBridge } from "./playwrightBridge.js";

/**
 * Puente de navegador para cadenas SSR (Next.js) protegidas por antibot
 * (Líder, Tottus). Su fetch plano cae en el bloqueo por fingerprint del
 * cliente; el navegador real del usuario sí pasa el desafío. Este puente
 * automatiza esa navegación con Playwright reusando el perfil de Chrome del
 * usuario, así el servidor MCP sigue sin ver credenciales.
 */
export interface SsrBrowserBridge {
  /** HTML ya renderizado (con `__NEXT_DATA__`) de una URL SSR. */
  fetchSsrHtml(url: string): Promise<string>;
}

/** Host base por cadena SSR con antibot (para armar la URL absoluta). */
const SSR_HOSTS: Partial<Record<StoreId, string>> = {
  lider: "https://super.lider.cl",
  tottus: "https://www.tottus.cl",
};

/** Cadenas cuyo fetch plano bloquea el antibot y que aceptan el puente. */
export function storeSupportsBrowserBridge(store: StoreId): boolean {
  return store in SSR_HOSTS;
}

/**
 * Construye una `Session` que resuelve la búsqueda de `store` navegando con el
 * puente. El adaptador arma su path relativo (`/search?query=…`) y aquí se le
 * antepone el host; el bridge devuelve el HTML renderizado que el extractor de
 * la cadena ya sabe parsear. Devuelve undefined si la cadena no usa puente.
 */
export function bridgeSession(
  store: StoreId,
  bridge: SsrBrowserBridge,
  branchId?: string
): Session | undefined {
  const host = SSR_HOSTS[store];
  if (!host) return undefined;
  return {
    store,
    ...(branchId ? { branchId } : {}),
    fetchAuthedHtml: (path) =>
      bridge.fetchSsrHtml(path.startsWith("http") ? path : host + path),
  };
}

// --- Puente configurado por entorno (singleton perezoso) ---

// undefined = aún no resuelto; null = resuelto a "no configurado".
let cached: SsrBrowserBridge | null | undefined;

/**
 * Puente Playwright configurado por variables de entorno, o undefined si no
 * está configurado (entonces se usa el flujo manual con `browserHtml`).
 *
 * Activación (en la config del cliente MCP, sección `env`):
 *   SUPERMERCADOS_PLAYWRIGHT_PROFILE=/ruta/al/perfil/de/Chrome   (requerida)
 *   SUPERMERCADOS_PLAYWRIGHT_CHANNEL=chrome|msedge               (opcional)
 *   SUPERMERCADOS_PLAYWRIGHT_HEADLESS=1                          (opcional)
 *
 * Reusa el perfil del usuario (donde ya vive la sesión), así el server no ve
 * credenciales. Requiere Playwright instalado aparte (dependencia opcional).
 */
export function getConfiguredBrowserBridge(): SsrBrowserBridge | undefined {
  if (cached !== undefined) return cached ?? undefined;
  const userDataDir = process.env.SUPERMERCADOS_PLAYWRIGHT_PROFILE?.trim();
  if (!userDataDir) {
    cached = null;
    return undefined;
  }
  const channelEnv = process.env.SUPERMERCADOS_PLAYWRIGHT_CHANNEL?.trim();
  const channel =
    channelEnv === "chrome" || channelEnv === "msedge" ? channelEnv : undefined;
  const headless = /^(1|true|yes)$/i.test(
    process.env.SUPERMERCADOS_PLAYWRIGHT_HEADLESS?.trim() ?? ""
  );
  cached = new PlaywrightBridge({
    userDataDir,
    ...(channel ? { channel } : {}),
    headless,
  });
  return cached;
}

/** Solo para tests: fija (o limpia con null) el puente configurado. */
export function setBrowserBridgeForTests(bridge: SsrBrowserBridge | null): void {
  cached = bridge;
}
