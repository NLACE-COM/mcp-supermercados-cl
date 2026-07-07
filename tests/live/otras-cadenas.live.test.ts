import { describe, expect, it } from "vitest";
import { LiderAdapter } from "../../src/adapters/lider.js";
import { TottusAdapter } from "../../src/adapters/tottus.js";
import { UnimarcAdapter } from "../../src/adapters/unimarc.js";
import { ProductSchema } from "../../src/core/types.js";

/**
 * Smoke live de Unimarc, Tottus y Lider. Requieren IP RESIDENCIAL (la
 * máquina del usuario). Desde datacenter estas cadenas bloquean (403/antibots),
 * por eso son opt-in con LIVE=1 y no corren en CI.
 */
const live = process.env.LIVE === "1" ? describe : describe.skip;

live("Unimarc en vivo", () => {
  it("search_products devuelve productos válidos", async () => {
    const products = await new UnimarcAdapter().searchProducts("leche", { limit: 5 });
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) {
      ProductSchema.parse(p);
      expect(p.store).toBe("unimarc");
    }
  }, 30000);
});

live("Tottus en vivo", () => {
  it("search_products devuelve productos válidos", async () => {
    const products = await new TottusAdapter().searchProducts("arroz", { limit: 5 });
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) {
      ProductSchema.parse(p);
      expect(p.store).toBe("tottus");
    }
  }, 30000);
});

live("Lider en vivo", () => {
  it("search_products devuelve productos válidos", async () => {
    const products = await new LiderAdapter().searchProducts("arroz", { limit: 5 });
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) {
      ProductSchema.parse(p);
      expect(p.store).toBe("lider");
    }
  }, 30000);
});
