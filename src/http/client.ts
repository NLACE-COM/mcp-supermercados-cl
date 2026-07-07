/**
 * Cliente HTTP compartido: rate limit por host, reintentos con backoff
 * y user-agent realista. Todo el tráfico del MCP pasa por aquí para
 * mantener ritmo humano (regla del plan: ~1 req/s por dominio, con jitter).
 */

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface HttpClientOptions {
  /** Espera mínima entre requests al mismo host, en ms (default 1000) */
  minDelayMs?: number;
  /** Jitter máximo agregado a la espera, en ms (default 400) */
  jitterMs?: number;
  /** Reintentos ante 429/5xx/errores de red (default 1: fallar rápido) */
  maxRetries?: number;
  /** Timeout por request en ms (default 8000) */
  timeoutMs?: number;
  userAgent?: string;
  /**
   * Sufijos de hosts de API que toleran ritmo más rápido (endpoints de
   * búsqueda/BFF diseñados para tráfico interactivo). Los sitios SSR que
   * scrapeamos (www.*, super.lider.cl) mantienen el ritmo conservador.
   */
  fastHostSuffixes?: string[];
  /** Espera mínima para los hosts rápidos, en ms (default 350) */
  fastDelayMs?: number;
}

/** Lee un entero >= 0 desde el entorno; undefined si no está o no es válido. */
function envInt(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

export interface HttpGetOptions {
  headers?: Record<string, string>;
}

/** Interfaz mínima que consumen los adaptadores; facilita fakes en tests. */
export interface HttpFetcher {
  getJson<T = unknown>(url: string, opts?: HttpGetOptions): Promise<T>;
  getText(url: string, opts?: HttpGetOptions): Promise<string>;
  postJson<T = unknown>(
    url: string,
    body: unknown,
    opts?: HttpGetOptions
  ): Promise<T>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HttpClient implements HttpFetcher {
  private readonly minDelayMs: number;
  private readonly jitterMs: number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly fastHostSuffixes: string[];
  private readonly fastDelayMs: number;
  /** Promesa de la última request en vuelo por host, para serializar. */
  private queues = new Map<string, Promise<void>>();
  private lastRequestAt = new Map<string, number>();

  constructor(options: HttpClientOptions = {}) {
    // Overrides por entorno para afinar sin recompilar (todos en ms/enteros):
    // SUPERMERCADOS_MIN_DELAY_MS, SUPERMERCADOS_FAST_DELAY_MS,
    // SUPERMERCADOS_TIMEOUT_MS, SUPERMERCADOS_MAX_RETRIES.
    this.minDelayMs =
      options.minDelayMs ?? envInt("SUPERMERCADOS_MIN_DELAY_MS") ?? 1000;
    this.jitterMs = options.jitterMs ?? 400;
    this.maxRetries =
      options.maxRetries ?? envInt("SUPERMERCADOS_MAX_RETRIES") ?? 1;
    this.timeoutMs =
      options.timeoutMs ?? envInt("SUPERMERCADOS_TIMEOUT_MS") ?? 8000;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.fastHostSuffixes = options.fastHostSuffixes ?? [];
    this.fastDelayMs =
      options.fastDelayMs ?? envInt("SUPERMERCADOS_FAST_DELAY_MS") ?? 350;
  }

  async getJson<T = unknown>(url: string, opts: HttpGetOptions = {}): Promise<T> {
    const res = await this.get(url, {
      headers: { Accept: "application/json", ...opts.headers },
    });
    return (await res.json()) as T;
  }

  async getText(url: string, opts: HttpGetOptions = {}): Promise<string> {
    const res = await this.get(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...opts.headers,
      },
    });
    return res.text();
  }

  async postJson<T = unknown>(
    url: string,
    body: unknown,
    opts: HttpGetOptions = {}
  ): Promise<T> {
    const res = await this.request(url, {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...opts.headers,
      },
    });
    return (await res.json()) as T;
  }

  /** GET con rate limit por host y reintentos. Lanza si agota reintentos. */
  async get(url: string, opts: HttpGetOptions = {}): Promise<Response> {
    return this.request(url, { method: "GET", headers: opts.headers });
  }

  /** Request con rate limit por host y reintentos, para GET y POST. */
  private async request(
    url: string,
    opts: { method: string; body?: string; headers?: Record<string, string> }
  ): Promise<Response> {
    const host = new URL(url).host;
    // Serializar por host: encadenar sobre la cola existente.
    const prev = this.queues.get(host) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((r) => (release = r));
    this.queues.set(host, prev.then(() => current));
    await prev;

    try {
      await this.respectRateLimit(host);
      return await this.getWithRetries(url, opts);
    } finally {
      release();
      if (this.queues.get(host) === current) this.queues.delete(host);
    }
  }

  private isFastHost(host: string): boolean {
    return this.fastHostSuffixes.some(
      (s) => host === s || host.endsWith(`.${s}`)
    );
  }

  private async respectRateLimit(host: string): Promise<void> {
    const last = this.lastRequestAt.get(host);
    if (last !== undefined) {
      const fast = this.isFastHost(host);
      const base = fast ? this.fastDelayMs : this.minDelayMs;
      // Jitter proporcional al ritmo del host para no perder la ganancia.
      const jitter = fast
        ? Math.min(this.jitterMs, 150)
        : this.jitterMs;
      const wait = base + Math.random() * jitter - (Date.now() - last);
      if (wait > 0) await sleep(wait);
    }
    this.lastRequestAt.set(host, Date.now());
  }

  private async getWithRetries(
    url: string,
    opts: { method?: string; body?: string; headers?: Record<string, string> }
  ): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        // Backoff exponencial: 1s, 2s, 4s... (+ jitter), según maxRetries.
        await sleep(1000 * 2 ** (attempt - 1) + Math.random() * 300);
      }
      try {
        const res = await fetch(url, {
          method: opts.method ?? "GET",
          ...(opts.body !== undefined ? { body: opts.body } : {}),
          headers: {
            "User-Agent": this.userAgent,
            "Accept-Language": "es-CL,es;q=0.9",
            ...opts.headers,
          },
          signal: AbortSignal.timeout(this.timeoutMs),
          redirect: "follow",
        });
        if (res.ok) return res;
        // 4xx (salvo 429) es error definitivo: reintentar no ayuda.
        if (res.status !== 429 && res.status < 500) {
          throw new HttpStatusError(url, res.status);
        }
        lastError = new HttpStatusError(url, res.status);
      } catch (err) {
        if (err instanceof HttpStatusError && err.status !== 429 && err.status < 500) {
          throw err;
        }
        lastError = err;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`GET ${url} falló tras ${this.maxRetries + 1} intentos`);
  }
}

export class HttpStatusError extends Error {
  constructor(
    url: string,
    public readonly status: number
  ) {
    super(`HTTP ${status} en GET ${url}`);
    this.name = "HttpStatusError";
  }
}

/**
 * Instancia compartida por defecto (una cola de rate limit por proceso).
 * Los hosts de API (Constructor.io y los BFF de Cencosud/Unimarc/Santa
 * Isabel) son endpoints de búsqueda interactiva: toleran ritmo más rápido
 * que los sitios SSR que scrapeamos (Tottus/Lider/PDPs www.*).
 */
export const defaultHttpClient = new HttpClient({
  fastHostSuffixes: [
    "cnstrc.com",
    "ecomm.cencosud.com",
    "bff-unimarc-ecommerce.unimarc.cl",
    "bff.santaisabel.cl",
  ],
});
