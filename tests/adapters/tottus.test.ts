import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TottusAdapter, extractTottusResults } from "../../src/adapters/tottus.js";
import { ProductSchema } from "../../src/core/types.js";
import type { HttpFetcher } from "../../src/http/client.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = JSON.parse(
  readFileSync(join(fixturesDir, "tottus-search-arroz.json"), "utf-8")
);

describe("TottusAdapter · mapProduct", () => {
  const adapter = new TottusAdapter();

  it("mapea internetPrice/normalPrice y precio por unidad (pum)", () => {
    const p = adapter.mapProduct(fixture.products[0])!;
    ProductSchema.parse(p);
    expect(p.store).toBe("tottus");
    expect(p.price).toBe(950); // internetPrice
    expect(p.listPrice).toBe(1190); // normalPrice crossed
    expect(p.unitPrice).toBe(950);
    expect(p.unit).toBe("kg");
    expect(p.offer?.type).toBe("descuento");
  });

  it("producto sin normalPrice no inventa listPrice", () => {
    const p = adapter.mapProduct(fixture.products[1])!;
    expect(p.price).toBe(1290);
    expect(p.listPrice).toBeUndefined();
    expect(p.offer).toBeUndefined();
  });

  it("searchProducts pide el HTML SSR y mapea", async () => {
    // HTML mínimo con __NEXT_DATA__ que envuelve la fixture
    const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
      { props: { pageProps: { results: fixture.products } } }
    )}</script></body></html>`;
    const http: HttpFetcher = {
      async getText(url: string) {
        expect(url).toContain("tottus.cl/tottus-cl/buscar?Ntt=arroz");
        return html;
      },
      async getJson<T>(): Promise<T> {
        throw new Error("no");
      },
      async postJson<T>(): Promise<T> {
        throw new Error("no");
      },
    };
    const products = await new TottusAdapter(http).searchProducts("arroz");
    expect(products.length).toBe(2);
    for (const p of products) ProductSchema.parse(p);
  });
});

describe("extractTottusResults", () => {
  it("devuelve [] si no hay __NEXT_DATA__", () => {
    expect(extractTottusResults("<html></html>")).toEqual([]);
  });
});
