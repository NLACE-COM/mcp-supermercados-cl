import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LiderAdapter,
  extractLiderProducts,
  isLiderBlockedHtml,
  wrapLiderHtml,
} from "../../src/adapters/lider.js";
import { toActionableError } from "../../src/core/errors.js";
import { ProductSchema } from "../../src/core/types.js";
import type { HttpFetcher } from "../../src/http/client.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = JSON.parse(
  readFileSync(join(fixturesDir, "lider-search-arroz.json"), "utf-8")
);

describe("LiderAdapter · mapProduct", () => {
  const adapter = new LiderAdapter();

  it("mapea linePrice/wasPrice y precio por unidad", () => {
    const p = adapter.mapProduct(fixture.products[0])!;
    ProductSchema.parse(p);
    expect(p.store).toBe("lider");
    expect(p.price).toBe(1190); // linePrice vigente
    expect(p.listPrice).toBe(1790); // wasPrice normal
    expect(p.unitPrice).toBe(1190);
    expect(p.unit).toBe("kg");
    expect(p.id).toBe("00780142021013");
    expect(p.url).toContain("super.lider.cl/ip/");
    // enriquecimiento
    expect(p.imageUrl).toContain("walmartimages.cl");
  });

  it("producto sin wasPrice no inventa descuento", () => {
    const p = adapter.mapProduct(fixture.products[2])!;
    expect(p.price).toBe(1590);
    expect(p.listPrice).toBeUndefined();
    expect(p.offer).toBeUndefined();
  });

  it("searchProducts extrae del __NEXT_DATA__ SSR", async () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: {
        pageProps: {
          initialData: { searchResult: { itemStacks: [{ items: fixture.products }] } },
        },
      },
    })}</script>`;
    const http: HttpFetcher = {
      async getText(url: string) {
        expect(url).toContain("super.lider.cl/search?query=arroz");
        return html;
      },
      async getJson<T>(): Promise<T> {
        throw new Error("no");
      },
      async postJson<T>(): Promise<T> {
        throw new Error("no");
      },
    };
    const products = await new LiderAdapter(http).searchProducts("arroz");
    expect(products.length).toBe(3);
    for (const p of products) ProductSchema.parse(p);
  });

  it("usa el puente de navegador de la sesión si está presente", async () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      a: { items: fixture.products },
    })}</script>`;
    let bridged = false;
    const http: HttpFetcher = {
      async getText(): Promise<string> {
        throw new Error("no debería usar HTTP directo");
      },
      async getJson<T>(): Promise<T> {
        throw new Error("no");
      },
      async postJson<T>(): Promise<T> {
        throw new Error("no");
      },
    };
    const products = await new LiderAdapter(http).searchProducts("arroz", {
      session: {
        store: "lider",
        fetchAuthedHtml: async () => {
          bridged = true;
          return html;
        },
      },
    });
    expect(bridged).toBe(true);
    expect(products.length).toBe(3);
  });
});

describe("LiderAdapter · bloqueo antibot", () => {
  it("detecta la página de PerimeterX (sin __NEXT_DATA__ o 'Robot or human')", () => {
    expect(isLiderBlockedHtml("<html><title>Robot or human?</title></html>")).toBe(
      true
    );
    expect(isLiderBlockedHtml("blocked - redirecting")).toBe(true);
    expect(
      isLiderBlockedHtml('<script id="__NEXT_DATA__" type="application/json">{}')
    ).toBe(false);
  });

  it("searchProducts lanza error de bloqueo en vez de devolver 0 resultados", async () => {
    const http: HttpFetcher = {
      async getText() {
        return "<html><title>Robot or human?</title></html>";
      },
      async getJson<T>(): Promise<T> {
        throw new Error("no");
      },
      async postJson<T>(): Promise<T> {
        throw new Error("no");
      },
    };
    const err = await new LiderAdapter(http)
      .searchProducts("pisco")
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    // El error se clasifica como "blocked" y su acción distingue bloqueo de vacío.
    const actionable = toActionableError(err, "lider");
    expect(actionable.kind).toBe("blocked");
    expect(actionable.action).toContain("intermitente");
  });
});

describe("wrapLiderHtml · puente de navegador para búsqueda", () => {
  const nextData = JSON.stringify({ x: { items: fixture.products } });

  it("envuelve el JSON de __NEXT_DATA__ y queda parseable", () => {
    expect(extractLiderProducts(wrapLiderHtml(nextData))).toHaveLength(3);
  });

  it("deja pasar el HTML completo tal cual", () => {
    const full = `<html><body><script id="__NEXT_DATA__" type="application/json">${nextData}</script></body></html>`;
    expect(wrapLiderHtml(full)).toBe(full);
    expect(extractLiderProducts(wrapLiderHtml(full))).toHaveLength(3);
  });

  it("searchProducts consume el HTML del navegador vía sesión (sin tocar la red)", async () => {
    const http: HttpFetcher = {
      async getText(): Promise<string> {
        throw new Error("no debería tocar la red");
      },
      async getJson<T>(): Promise<T> {
        throw new Error("no");
      },
      async postJson<T>(): Promise<T> {
        throw new Error("no");
      },
    };
    const products = await new LiderAdapter(http).searchProducts("arroz", {
      session: {
        store: "lider",
        fetchAuthedHtml: async () => wrapLiderHtml(nextData),
      },
    });
    expect(products).toHaveLength(3);
  });
});

describe("extractLiderProducts", () => {
  it("encuentra el arreglo de Product en un árbol anidado", () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      deep: { nested: { items: fixture.products } },
    })}</script>`;
    expect(extractLiderProducts(html)).toHaveLength(3);
  });

  it("devuelve [] si no hay productos", () => {
    expect(extractLiderProducts("<html></html>")).toEqual([]);
  });
});
