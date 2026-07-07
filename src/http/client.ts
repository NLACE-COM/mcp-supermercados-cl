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
  /** Reintentos ante 429/5xx/errores de red (default 3) */
  maxRetries?: number;
  /** Timeout por request en ms (default 15000) */
  timeoutMs?: number;
  userAgent?: string;
}

export interface HttpGetOptions {
  headers?: Record<string, string>;
}

/** Interfaz mínima que consumen los adaptadores; facilita fakes en tests. */
export interface HttpFetcher {
  getJson<T = unknown>(url: string, opts?: HttpGetOptions): Promise<T>;
  getText(url: string, opts?: HttpGetOptions): Promise<string>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HttpClient implements HttpFetcher {
  private readonly minDelayMs: number;
  private readonly jitterMs: number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  /** Promesa de la última request en vuelo por host, para serializar. */
  private queues = new Map<string, Promise<void>>();
  private lastRequestAt = new Map<string, number>();

  constructor(options: HttpClientOptions = {}) {
    this.minDelayMs = options.minDelayMs ?? 1000;
    this.jitterMs = options.jitterMs ?? 400;
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
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

  /** GET con rate limit por host y reintentos. Lanza si agota reintentos. */
  async get(url: string, opts: HttpGetOptions = {}): Promise<Response> {
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

  private async respectRateLimit(host: string): Promise<void> {
    const last = this.lastRequestAt.get(host);
    if (last !== undefined) {
      const wait =
        this.minDelayMs + Math.random() * this.jitterMs - (Date.now() - last);
      if (wait > 0) await sleep(wait);
    }
    this.lastRequestAt.set(host, Date.now());
  }

  private async getWithRetries(
    url: string,
    opts: HttpGetOptions
  ): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        // Backoff exponencial: 1s, 2s, 4s (+ jitter)
        await sleep(1000 * 2 ** (attempt - 1) + Math.random() * 300);
      }
      try {
        const res = await fetch(url, {
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

/** Instancia compartida por defecto (una cola de rate limit por proceso). */
export const defaultHttpClient = new HttpClient();
