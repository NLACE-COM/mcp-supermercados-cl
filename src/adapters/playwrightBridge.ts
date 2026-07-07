import type { BrowserBridge } from "./session.js";

/**
 * Puente de navegador con Playwright: automatiza el "flujo rápido" de sesión
 * (ejecutar el `browserSnippet` de una tool en el sitio logueado) para que el
 * usuario no tenga que copiar/pegar a mano. Reusa el **perfil de Chrome del
 * usuario** (donde ya está la sesión), así el servidor MCP sigue sin ver
 * credenciales: solo se ejecuta lo que el propio navegador logueado haría.
 *
 * Playwright es una dependencia OPCIONAL y pesada (baja navegadores), así que
 * NO va en las dependencias del paquete: se carga dinámicamente. Para usar
 * este puente, instala Playwright aparte:
 *
 *     npm install playwright
 *     npx playwright install chromium   # o usa channel "chrome"
 *
 * Este helper corre junto al cliente (no dentro del servidor MCP por stdio):
 * úsalo en un script Node para obtener el JSON/HTML y pasárselo a las tools.
 *
 * OJO: `launchPersistentContext` toma el perfil real; Chrome debe estar
 * cerrado (o usa un `userDataDir` copiado) para evitar el lock del perfil.
 */
export interface PlaywrightBridgeOptions {
  /** Carpeta del perfil de Chrome del usuario (con la sesión iniciada). */
  userDataDir: string;
  /** Canal del navegador: "chrome" (instalado) o undefined (chromium de PW). */
  channel?: "chrome" | "msedge";
  /** headless: por defecto false para no gatillar antibots ni 2FA. */
  headless?: boolean;
  /** Base del sitio para rutas relativas (default Jumbo). */
  baseUrl?: string;
}

/** Forma mínima de Playwright que usamos (evita depender de sus tipos). */
interface PlaywrightLike {
  chromium: {
    launchPersistentContext: (
      userDataDir: string,
      opts: Record<string, unknown>
    ) => Promise<PlaywrightContext>;
  };
}
interface PlaywrightContext {
  newPage: () => Promise<PlaywrightPage>;
  close: () => Promise<void>;
}
interface PlaywrightPage {
  goto: (url: string, opts?: Record<string, unknown>) => Promise<unknown>;
  evaluate: <T>(fn: string) => Promise<T>;
  content: () => Promise<string>;
}

async function loadPlaywright(): Promise<PlaywrightLike> {
  try {
    // Especificador en variable: playwright es opcional y no está en las
    // deps, así que TypeScript no debe intentar resolver el módulo aquí. El
    // import dinámico solo funciona si el usuario lo instaló.
    const moduleName = "playwright";
    return (await import(moduleName)) as unknown as PlaywrightLike;
  } catch {
    throw new Error(
      "Playwright no está instalado. Para el puente automatizado ejecuta: " +
        "`npm install playwright` (y `npx playwright install chromium`). " +
        "Sin él, usa el flujo manual: ejecuta el browserSnippet de la tool en " +
        "el navegador y pasa el JSON de vuelta."
    );
  }
}

export class PlaywrightBridge implements BrowserBridge {
  private readonly opts: PlaywrightBridgeOptions;
  private context?: PlaywrightContext;

  constructor(opts: PlaywrightBridgeOptions) {
    this.opts = opts;
  }

  private baseUrl(): string {
    return this.opts.baseUrl ?? "https://www.jumbo.cl";
  }

  private async ensureContext(): Promise<PlaywrightContext> {
    if (this.context) return this.context;
    const pw = await loadPlaywright();
    this.context = await pw.chromium.launchPersistentContext(this.opts.userDataDir, {
      headless: this.opts.headless ?? false,
      ...(this.opts.channel ? { channel: this.opts.channel } : {}),
    });
    return this.context;
  }

  /**
   * Ejecuta un `browserSnippet` (JS) en una página ya cargada y logueada, y
   * devuelve su resultado. `pageUrl` debe ser una ruta del mismo origen del
   * sitio (por CORS): ej. "/productos-frecuentes" o "/" para las llamadas al
   * BFF. El snippet suele terminar en una expresión `await fetch(...)`.
   */
  async evaluate<T>(pageUrl: string, snippet: string): Promise<T> {
    const ctx = await this.ensureContext();
    const page = await ctx.newPage();
    const url = pageUrl.startsWith("http") ? pageUrl : this.baseUrl() + pageUrl;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    // El snippet usa top-level await; lo envolvemos en una IIFE async.
    return page.evaluate<T>(`(async () => { return (${snippet}); })()`);
  }

  /** HTML autenticado de una ruta (implementa BrowserBridge). */
  async fetchAuthedHtml(path: string): Promise<string> {
    const ctx = await this.ensureContext();
    const page = await ctx.newPage();
    const url = path.startsWith("http") ? path : this.baseUrl() + path;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    return page.content();
  }

  async close(): Promise<void> {
    await this.context?.close();
    this.context = undefined;
  }
}
