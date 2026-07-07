import { describe, expect, it } from "vitest";
import { CencosudAdapter, JUMBO_CONFIG } from "../../src/adapters/cencosud.js";
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
    const products = await adapter.searchProducts("arroz", { limit: 1 });
    expect(products[0]?.url).toBeTruthy();
    const detail = await adapter.getProduct(products[0].url!);
    expect(detail).not.toBeNull();
    ProductSchema.parse(detail);
  }, 45000);
});
