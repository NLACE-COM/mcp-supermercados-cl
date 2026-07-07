import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CencosudAdapter,
  SANTA_ISABEL_CONFIG,
} from "../../src/adapters/cencosud.js";
import { ProductSchema } from "../../src/core/types.js";
import type { HttpFetcher } from "../../src/http/client.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const searchFixture = JSON.parse(
  readFileSync(join(fixturesDir, "santaisabel-search-arroz.json"), "utf-8")
);

/**
 * Fase 4: Santa Isabel reutiliza el adaptador Cencosud para la BÚSQUEDA
 * (mismo backend Constructor, otra key/host). getProduct y getOffers no
 * están habilitados para este banner y deben fallar con un mensaje claro.
 */
describe("Santa Isabel · búsqueda (reusa Cencosud)", () => {
  function adapterWith(fixture: unknown) {
    const http: HttpFetcher = {
      async getJson<T>(url: string): Promise<T> {
        // valida que apunta al host/key correctos de Santa Isabel
        const u = new URL(url);
        expect(u.host).toBe("ac.cnstrc.com");
        expect(u.searchParams.get("key")).toBe("key_c73M3GMIWJ8AcNnd");
        return fixture as T;
      },
      async getText(): Promise<string> {
        throw new Error("no debería llamarse");
      },
    };
    return new CencosudAdapter(SANTA_ISABEL_CONFIG, http, "test-uuid");
  }

  it("mapea resultados a Product válidos con store santaisabel", async () => {
    const products = await adapterWith(searchFixture).searchProducts("arroz");
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) {
      const parsed = ProductSchema.parse(p);
      expect(parsed.store).toBe("santaisabel");
      expect(parsed.price).toBeGreaterThan(0);
    }
  });

  it("respeta las URLs propias de Santa Isabel (www.sisa.cl)", async () => {
    const products = await adapterWith(searchFixture).searchProducts("arroz");
    const withUrl = products.find((p) => p.url);
    expect(withUrl?.url).toContain("sisa.cl");
  });

  it("captura ofertas reales (selling < list) del payload", () => {
    const adapter = new CencosudAdapter(SANTA_ISABEL_CONFIG);
    // un resultado con descuento de la fixture, si lo hay:
    const results = searchFixture.response.results as Array<Record<string, unknown>>;
    for (const raw of results) {
      const p = adapter.mapSearchResult(raw as never);
      if (p?.listPrice !== undefined) {
        expect(p.listPrice).toBeGreaterThan(p.price);
        expect(p.offer?.type).toBe("descuento");
      }
    }
  });
});

describe("Santa Isabel · capacidades no soportadas fallan con mensaje claro", () => {
  const adapter = new CencosudAdapter(SANTA_ISABEL_CONFIG);

  it("getProduct explica que requiere comuna y sugiere search_products", async () => {
    await expect(adapter.getProduct("cualquier-slug")).rejects.toThrow(
      /comuna|search_products/
    );
  });

  it("getOffers explica que no hay colección para el banner", async () => {
    await expect(adapter.getOffers()).rejects.toThrow(
      /no está disponible|colección/
    );
  });
});

describe("registry incluye Santa Isabel", async () => {
  const { availableStores } = await import("../../src/core/registry.js");
  it("santaisabel está disponible junto a jumbo", () => {
    expect(availableStores()).toContain("santaisabel");
    expect(availableStores()).toContain("jumbo");
  });
});
