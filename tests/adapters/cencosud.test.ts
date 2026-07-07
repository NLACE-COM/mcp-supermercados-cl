import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CencosudAdapter,
  JUMBO_CONFIG,
  buildVariationsMap,
  extractDehydratedState,
} from "../../src/adapters/cencosud.js";
import { ProductSchema } from "../../src/core/types.js";
import type { HttpFetcher } from "../../src/http/client.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

const searchFixture = JSON.parse(
  readFileSync(join(fixturesDir, "constructor-search-arroz.json"), "utf-8")
);
const pdpFixture = readFileSync(join(fixturesDir, "pdp-arroz-banquete.html"), "utf-8");
const offersFixture = JSON.parse(
  readFileSync(join(fixturesDir, "constructor-browse-ofertas.json"), "utf-8")
);

/**
 * Test de contrato del adaptador Cencosud contra respuestas REALES
 * grabadas el 2026-07-06. Si Jumbo cambia el formato, estos tests marcan
 * qué se rompió sin depender de la red. El smoke contra el sitio vivo
 * está en tests/live/.
 */
describe("CencosudAdapter · búsqueda (Constructor.io)", () => {
  const adapter = new CencosudAdapter(JUMBO_CONFIG);
  const results = searchFixture.response.results as Array<Record<string, unknown>>;

  it("la fixture mantiene la forma esperada de Constructor", () => {
    expect(searchFixture.response).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const first = results[0] as { data: Record<string, unknown> };
    // Campos de los que depende el mapeo:
    expect(first.data).toHaveProperty("id");
    expect(first.data).toHaveProperty("sellingPrice");
    expect(first.data).toHaveProperty("listPrice");
    expect(first.data).toHaveProperty("stockLevel");
    expect(first.data).toHaveProperty("SkuData");
  });

  it("mapea todos los resultados a Product válidos (zod)", () => {
    for (const raw of results) {
      const product = adapter.mapSearchResult(raw as never);
      expect(product).not.toBeNull();
      const parsed = ProductSchema.parse(product);
      expect(parsed.store).toBe("jumbo");
      expect(parsed.price).toBeGreaterThan(0);
      expect(parsed.fetchedAt).toBeTruthy();
    }
  });

  it("separa precio vigente y precio lista cuando hay oferta", () => {
    // El Banquete de la fixture: price 2490, sellingPrice 1890.
    const banquete = results.find((r) =>
      String((r as { value?: string }).value).includes("Banquete")
    );
    const product = adapter.mapSearchResult(banquete as never)!;
    expect(product.price).toBe(1890);
    expect(product.listPrice).toBe(2490);
    expect(product.offer?.type).toBe("descuento");
  });

  it("calcula precio por unidad desde SkuData", () => {
    // Arroz 1 kg con unit_multiplier_un=1 => unitPrice == price, unit "kg".
    const banquete = results.find((r) =>
      String((r as { value?: string }).value).includes("Banquete")
    );
    const product = adapter.mapSearchResult(banquete as never)!;
    expect(product.unit).toBe("kg");
    expect(product.unitPrice).toBe(product.price);
  });

  it("sin oferta no inventa listPrice", () => {
    const sinOferta = results.find(
      (r) =>
        (r as { data: Record<string, unknown> }).data.sellingPrice ===
        (r as { data: Record<string, unknown> }).data.listPrice
    );
    expect(sinOferta).toBeDefined();
    const product = adapter.mapSearchResult(sinOferta as never)!;
    expect(product.listPrice).toBeUndefined();
    expect(product.offer).toBeUndefined();
  });

  it("con branchId usa los valores del variations_map de esa sucursal", () => {
    const raw = structuredClone(results[0]) as Record<string, unknown>;
    raw.variations_map = [
      {
        variation: "x-jumboclj520",
        price: 2490,
        sellingPrice: 1790,
        listPrice: 2440,
        stockLevel: "in-stock",
        storeId: "jumboclj520",
      },
    ];
    const product = adapter.mapSearchResult(raw as never, "jumboclj520")!;
    expect(product.price).toBe(1790);
    expect(product.listPrice).toBe(2440);
    expect(product.inStock).toBe(true);
  });

  it("con branchId y sin variación local marca sin stock", () => {
    const raw = structuredClone(results[0]) as Record<string, unknown>;
    delete raw.variations_map;
    const product = adapter.mapSearchResult(raw as never, "jumboclj999")!;
    expect(product.inStock).toBe(false);
  });

  it("searchProducts arma el request correcto contra Constructor", async () => {
    const seen: string[] = [];
    const fakeHttp: HttpFetcher = {
      async getJson<T>(url: string): Promise<T> {
        seen.push(url);
        return searchFixture as T;
      },
      async getText(): Promise<string> {
        throw new Error("no debería llamarse");
      },
    };
    const a = new CencosudAdapter(JUMBO_CONFIG, fakeHttp, "test-uuid");
    const products = await a.searchProducts("arroz", {
      limit: 6,
      branchId: "jumboclj512",
    });

    expect(products.length).toBeGreaterThan(0);
    const url = new URL(seen[0]);
    expect(url.host).toBe("pwcdauseo-zone.cnstrc.com");
    expect(url.pathname).toBe("/search/arroz");
    expect(url.searchParams.get("key")).toBe("key_JopvNXKS61kwGkBe");
    expect(url.searchParams.get("i")).toBe("test-uuid");
    expect(url.searchParams.get("num_results_per_page")).toBe("6");
    const vm = JSON.parse(url.searchParams.get("variations_map")!);
    expect(vm.filter_by.and[0].value).toBe("jumboclj512");
  });
});

describe("CencosudAdapter · detalle de producto (PDP SSR)", () => {
  const adapter = new CencosudAdapter(JUMBO_CONFIG);

  it("extrae el estado deshidratado del HTML real", () => {
    const state = extractDehydratedState(pdpFixture);
    expect(state).not.toBeNull();
    expect((state as { queries: unknown[] }).queries.length).toBeGreaterThan(0);
  });

  it("mapea la PDP con precio público, lista y Prime separados", () => {
    const state = extractDehydratedState(pdpFixture);
    const product = adapter.mapPdpState(
      state,
      "https://www.jumbo.cl/arroz-grado-1-banquete-1-kg-premium-grano-largo-y-ancho/p"
    )!;
    const parsed = ProductSchema.parse(product);

    // Valores reales de la captura del 2026-07-06:
    expect(parsed.price).toBe(1790);
    expect(parsed.listPrice).toBe(2440);
    expect(parsed.memberPrice).toBe(1600); // promo PRIME_USER
    expect(parsed.ean).toBe("7803110102212");
    expect(parsed.unit).toBe("kg");
    expect(parsed.inStock).toBe(true);
    expect(parsed.name).toContain("Banquete");
    // enriquecimiento: ingredientes de la ficha (para juicio de naturalidad)
    expect(parsed.ingredients).toEqual(["arroz grano largo ancho 95% grano entero"]);
  });

  it("getProduct resuelve slug, path y URL completa", async () => {
    const urls: string[] = [];
    const fakeHttp: HttpFetcher = {
      async getJson<T>(): Promise<T> {
        throw new Error("no debería llamarse");
      },
      async getText(url: string): Promise<string> {
        urls.push(url);
        return pdpFixture;
      },
    };
    const a = new CencosudAdapter(JUMBO_CONFIG, fakeHttp);

    const bySlug = await a.getProduct(
      "arroz-grado-1-banquete-1-kg-premium-grano-largo-y-ancho"
    );
    const byPath = await a.getProduct(
      "/arroz-grado-1-banquete-1-kg-premium-grano-largo-y-ancho/p"
    );
    const byUrl = await a.getProduct(
      "https://www.jumbo.cl/arroz-grado-1-banquete-1-kg-premium-grano-largo-y-ancho/p"
    );

    // Las tres formas resuelven a la misma URL; el cache TTL hace que solo
    // se fetchee una vez.
    expect(urls).toEqual([
      "https://www.jumbo.cl/arroz-grado-1-banquete-1-kg-premium-grano-largo-y-ancho/p",
    ]);
    expect(bySlug?.id).toBe(byPath?.id);
    expect(byPath?.id).toBe(byUrl?.id);
  });
});

describe("CencosudAdapter · ofertas (browse de colección)", () => {
  it("getOffers consulta la colección de ofertas y mapea productos con descuento", async () => {
    const seen: string[] = [];
    const fakeHttp: HttpFetcher = {
      async getJson<T>(url: string): Promise<T> {
        seen.push(url);
        return offersFixture as T;
      },
      async getText(): Promise<string> {
        throw new Error("no debería llamarse");
      },
    };
    const a = new CencosudAdapter(JUMBO_CONFIG, fakeHttp, "test-uuid");
    const products = await a.getOffers({ limit: 3 });

    const url = new URL(seen[0]);
    expect(url.pathname).toBe("/browse/collection_id/30399");
    expect(url.searchParams.get("key")).toBe("key_JopvNXKS61kwGkBe");

    expect(products.length).toBeGreaterThan(0);
    for (const p of products) {
      ProductSchema.parse(p);
      // En la colección de ofertas todos traen descuento real:
      expect(p.listPrice).toBeGreaterThan(p.price);
      expect(p.offer?.type).toBe("descuento");
    }
  });

  it("primeOnly usa la colección Prime y marca clubOnly", async () => {
    const seen: string[] = [];
    const fakeHttp: HttpFetcher = {
      async getJson<T>(url: string): Promise<T> {
        seen.push(url);
        return offersFixture as T;
      },
      async getText(): Promise<string> {
        throw new Error("no debería llamarse");
      },
    };
    const a = new CencosudAdapter(JUMBO_CONFIG, fakeHttp, "test-uuid");
    const products = await a.getOffers({ limit: 3, primeOnly: true });

    expect(new URL(seen[0]).pathname).toBe("/browse/collection_id/30307");
    for (const p of products) {
      expect(p.offer?.clubOnly).toBe(true);
      expect(p.offer?.type).toBe("club");
    }
  });

  it("resuelve categoría a group_id y filtra", async () => {
    const groupsResponse = {
      response: {
        results: [],
        groups: [
          {
            group_id: "27",
            display_name: "Despensa",
            children: [{ group_id: "30", display_name: "Arroz, Quinoa, Cuscús" }],
          },
        ],
      },
    };
    const seen: string[] = [];
    const fakeHttp: HttpFetcher = {
      async getJson<T>(url: string): Promise<T> {
        seen.push(url);
        return (seen.length === 1 ? groupsResponse : offersFixture) as T;
      },
      async getText(): Promise<string> {
        throw new Error("no debería llamarse");
      },
    };
    const a = new CencosudAdapter(JUMBO_CONFIG, fakeHttp, "test-uuid");
    await a.getOffers({ category: "despensa" });

    expect(seen).toHaveLength(2);
    expect(new URL(seen[1]).searchParams.get("filters[group_id]")).toBe("27");
  });

  it("categoría inexistente lanza error informativo", async () => {
    const fakeHttp: HttpFetcher = {
      async getJson<T>(): Promise<T> {
        return {
          response: {
            results: [],
            groups: [{ group_id: "27", display_name: "Despensa" }],
          },
        } as T;
      },
      async getText(): Promise<string> {
        throw new Error("no debería llamarse");
      },
    };
    const a = new CencosudAdapter(JUMBO_CONFIG, fakeHttp, "test-uuid");
    await expect(a.getOffers({ category: "juguetes" })).rejects.toThrow(
      /no encontrada.*Despensa/
    );
  });
});

describe("buildVariationsMap", () => {
  it("genera el filtro por sucursal verificado en la captura", () => {
    const vm = buildVariationsMap("jumboclj512");
    expect(vm.filter_by).toEqual({
      and: [{ field: "data.storeId", value: "jumboclj512" }],
    });
    expect(vm.dtype).toBe("array");
  });
});
