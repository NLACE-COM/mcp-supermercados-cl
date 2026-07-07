import { describe, expect, it } from "vitest";
import {
  CencosudAdapter,
  JUMBO_CONFIG,
  SANTA_ISABEL_CONFIG,
} from "../../src/adapters/cencosud.js";
import { ProductSchema } from "../../src/core/types.js";

/**
 * Smoke test contra el sitio real. Valida SOLO el contrato (esquema), no
 * valores. Se corre a mano con `npm run test:live` para detectar cambios
 * de endpoint; no corre en CI.
 */
const live = process.env.LIVE === "1" ? describe : describe.skip;

live("Jumbo en vivo", () => {
  const adapter = new CencosudAdapter(JUMBO_CONFIG);

  it("search_products devuelve productos válidos", async () => {
    const products = await adapter.searchProducts("leche", { limit: 5 });
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) {
      ProductSchema.parse(p);
    }
  }, 30000);

  it("getOffers devuelve productos válidos y al menos uno con descuento", async () => {
    const offers = await adapter.getOffers({ limit: 10 });
    expect(offers.length).toBeGreaterThan(0);
    for (const p of offers) {
      ProductSchema.parse(p);
    }
    // La colección puede incluir promos que no bajan el precio unitario
    // (ej. 2x), pero el grueso son descuentos directos:
    expect(offers.some((p) => (p.listPrice ?? 0) > p.price)).toBe(true);
  }, 30000);

  it("getProduct devuelve detalle con esquema válido", async () => {
    // Algunos productos puntuales no exponen estado deshidratado parseable;
    // probamos varios candidatos con URL hasta obtener un detalle.
    const products = await adapter.searchProducts("arroz", { limit: 5 });
    const withUrl = products.filter((p) => p.url);
    expect(withUrl.length).toBeGreaterThan(0);

    let detail = null;
    for (const p of withUrl) {
      detail = await adapter.getProduct(p.url!);
      if (detail) break;
    }
    expect(detail).not.toBeNull();
    ProductSchema.parse(detail);
  }, 60000);
});

live("Santa Isabel en vivo", () => {
  const adapter = new CencosudAdapter(SANTA_ISABEL_CONFIG);

  it("search_products devuelve productos válidos con precio", async () => {
    const products = await adapter.searchProducts("leche", { limit: 5 });
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) {
      ProductSchema.parse(p);
      expect(p.store).toBe("santaisabel");
      expect(p.price).toBeGreaterThan(0);
    }
  }, 30000);
});
