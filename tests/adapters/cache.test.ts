import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TtlCache } from "../../src/core/cache.js";

describe("TtlCache", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("devuelve el valor dentro del TTL y lo expira después", () => {
    const cache = new TtlCache<string>(1000);
    cache.set("k", "v");
    expect(cache.get("k")).toBe("v");

    vi.advanceTimersByTime(1001);
    expect(cache.get("k")).toBeUndefined();
  });

  it("getOrFetch solo llama al fetcher en miss", async () => {
    const cache = new TtlCache<number>(60_000);
    const fetcher = vi.fn(async () => 42);

    expect(await cache.getOrFetch("k", fetcher)).toBe(42);
    expect(await cache.getOrFetch("k", fetcher)).toBe(42);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("respeta el tope de entradas eliminando lo más antiguo", () => {
    const cache = new TtlCache<number>(60_000, 2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });
});
