import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { UnimarcAdapter } from "../../src/adapters/unimarc.js";
import { ProductSchema } from "../../src/core/types.js";
import type { HttpFetcher } from "../../src/http/client.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = JSON.parse(
  readFileSync(join(fixturesDir, "unimarc-search-detergente.json"), "utf-8")
);

describe("UnimarcAdapter · mapProduct", () => {
  const adapter = new UnimarcAdapter();

  it("mapea precio, precio lista, ppum y marca Club Unimarc como socio", () => {
    const p = adapter.mapProduct(fixture.availableProducts[0])!;
    ProductSchema.parse(p);
    expect(p.store).toBe("unimarc");
    expect(p.price).toBe(1000);
    expect(p.listPrice).toBe(1290);
    expect(p.unitPrice).toBe(2500);
    expect(p.unit).toBe("lt"); // "litro" normalizado
    expect(p.offer?.type).toBe("club");
    expect(p.offer?.clubOnly).toBe(true);
    expect(p.memberPrice).toBe(1000);
    expect(p.ean).toBe("7805000323677");
    // enriquecimiento
    expect(p.imageUrl).toContain("vtexassets.com");
    expect(p.description).toContain("Omo ultra power");
  });

  it("producto sin oferta ni club queda limpio", () => {
    const p = adapter.mapProduct(fixture.availableProducts[1])!;
    expect(p.price).toBe(3690);
    expect(p.listPrice).toBeUndefined();
    expect(p.memberPrice).toBeUndefined();
    expect(p.offer).toBeUndefined();
    expect(p.unit).toBe("lt");
  });

  it("searchProducts hace POST al BFF con el body correcto", async () => {
    let seenUrl = "";
    let seenBody: any = null;
    const http: HttpFetcher = {
      async postJson<T>(url: string, body: unknown): Promise<T> {
        seenUrl = url;
        seenBody = body;
        return fixture as T;
      },
      async getJson<T>(): Promise<T> {
        throw new Error("no");
      },
      async getText(): Promise<string> {
        throw new Error("no");
      },
    };
    const products = await new UnimarcAdapter(http).searchProducts("detergente", {
      limit: 49,
    });
    expect(seenUrl).toContain("bff-unimarc-ecommerce.unimarc.cl/catalog/product/search");
    expect(seenBody).toMatchObject({
      searching: "detergente",
      from: "0",
      to: "48",
      userTriggered: true,
    });
    expect(products.length).toBe(2);
    for (const p of products) ProductSchema.parse(p);
  });
});
