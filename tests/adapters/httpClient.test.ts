import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "../../src/http/client.js";

/**
 * Verifica el rate limit diferenciado (hosts de API rápidos vs. SSR lentos)
 * y que "fallar rápido" (menos reintentos) no reintente 4xx definitivos.
 * Usa timers falsos para no esperar de verdad.
 */
describe("HttpClient rate limit", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("aplica fastDelayMs a hosts de API y minDelayMs al resto", async () => {
    // Response nuevo por llamada: el body solo se puede leer una vez.
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient({
      minDelayMs: 1000,
      fastDelayMs: 300,
      jitterMs: 0,
      maxRetries: 0,
      fastHostSuffixes: ["cnstrc.com"],
    });

    // Primer request a cada host: sin espera previa.
    await client.getJson("https://ac.cnstrc.com/a");
    await client.getJson("https://www.jumbo.cl/b");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Segundo request al host rápido: debe bastar con avanzar fastDelayMs.
    const fastPromise = client.getJson("https://ac.cnstrc.com/c");
    await vi.advanceTimersByTimeAsync(300);
    await fastPromise;
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Segundo request al host lento: 300ms no alcanzan, 1000ms sí.
    const slowPromise = client.getJson("https://www.jumbo.cl/d");
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(700);
    await slowPromise;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("no reintenta un 404 (error definitivo)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new HttpClient({ maxRetries: 1, jitterMs: 0 });
    await expect(client.getJson("https://ac.cnstrc.com/x")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
