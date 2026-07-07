import { describe, expect, it, vi } from "vitest";
import { compareStores } from "../../src/core/compare.js";
import type { Product } from "../../src/core/types.js";

function product(store: string, name: string, price: number): Product {
  return {
    store: store as Product["store"],
    id: `${store}-${name}`,
    name,
    price,
    inStock: true,
    unitPrice: price,
    unit: "kg",
    fetchedAt: new Date().toISOString(),
  };
}

// Mock del registry: cada cadena devuelve precios distintos.
vi.mock("../../src/core/registry.js", () => ({
  getAdapter: (store: string) => ({
    id: store,
    async searchProducts(query: string) {
      if (store === "lider" && query === "café") return []; // Lider sin café
      const base: Record<string, number> = { jumbo: 1000, santaisabel: 900, lider: 1100 };
      return [product(store, `${query} ${store}`, base[store] ?? 1000)];
    },
  }),
  availableStores: () => ["jumbo", "santaisabel", "lider"],
}));

describe("compareStores", () => {
  it("elige la cadena más barata entre las que tienen todos los ítems", async () => {
    const result = await compareStores(
      ["leche", "arroz"],
      ["jumbo", "santaisabel", "lider"]
    );
    // santaisabel es la más barata (900 c/u) con todos los ítems
    expect(result.cheapest).toBe("santaisabel");
    const si = result.stores.find((s) => s.store === "santaisabel")!;
    expect(si.matched).toBe(2);
    expect(si.total).toBe(1800);
  });

  it("una cadena sin un ítem no es candidata a más barata", async () => {
    const result = await compareStores(["café"], ["jumbo", "lider"]);
    // Lider no tiene café => solo jumbo completa la lista
    const lider = result.stores.find((s) => s.store === "lider")!;
    expect(lider.matched).toBe(0);
    expect(result.cheapest).toBe("jumbo");
  });
});
