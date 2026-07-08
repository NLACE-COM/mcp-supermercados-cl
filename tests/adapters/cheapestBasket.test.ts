import { describe, expect, it } from "vitest";
import { chooseCheapestBasket } from "../../src/core/cheapestBasket.js";
import type { CompareResult } from "../../src/core/compare.js";
import type { Product, StoreId } from "../../src/core/types.js";

const prod = (over: Partial<Product> & { store: StoreId }): Product => ({
  id: "x",
  name: "p",
  price: 1000,
  inStock: true,
  fetchedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("chooseCheapestBasket", () => {
  it("elige por ítem la cadena más barata (por precio/unidad) y agrupa por cadena", () => {
    const cmp: CompareResult = {
      items: ["leche", "arroz"],
      stores: [
        {
          store: "jumbo",
          matched: 2,
          total: 2290,
          items: [
            { query: "leche", product: prod({ store: "jumbo", name: "Leche J", price: 1000, unitPrice: 1000, unit: "lt" }) },
            { query: "arroz", product: prod({ store: "jumbo", name: "Arroz J", price: 1290, unitPrice: 1290, unit: "kg" }) },
          ],
        },
        {
          store: "unimarc",
          matched: 2,
          total: 2350,
          items: [
            { query: "leche", product: prod({ store: "unimarc", name: "Leche U", price: 950, unitPrice: 950, unit: "lt" }) },
            { query: "arroz", product: prod({ store: "unimarc", name: "Arroz U", price: 1400, unitPrice: 1400, unit: "kg" }) },
          ],
        },
      ],
      cheapest: "jumbo",
      comparability: [
        { query: "leche", confidence: "same", chosen: [] },
        { query: "arroz", confidence: "mixed", chosen: [] },
      ],
      disclaimer: "x",
    };

    const b = chooseCheapestBasket(cmp);

    expect(b.picks.map((p) => [p.query, p.store, p.price, p.by])).toEqual([
      ["leche", "unimarc", 950, "unitPrice"],
      ["arroz", "jumbo", 1290, "unitPrice"],
    ]);
    expect(b.picks[0]!.alternatives).toEqual([
      { store: "jumbo", name: "Leche J", price: 1000, unitPrice: 1000, unit: "lt" },
    ]);
    expect(b.basketTotal).toBe(2240);
    // plan agrupado por cadena
    const plan = Object.fromEntries(b.plan.map((s) => [s.store, s.subtotal]));
    expect(plan).toEqual({ unimarc: 950, jumbo: 1290 });
    // ahorro de repartir vs mejor cadena única (jumbo 2290)
    expect(b.singleStore).toEqual({ store: "jumbo", total: 2290 });
    expect(b.splitSaving).toBe(50);
    expect(b.mixedFormatItems).toEqual(["arroz"]);
    expect(b.missing).toEqual([]);
  });

  it("ignora cadenas con error y marca los ítems sin match como missing", () => {
    const cmp: CompareResult = {
      items: ["pan"],
      stores: [
        { store: "tottus", matched: 0, total: 0, items: [], error: "HTTP 403" },
        { store: "jumbo", matched: 0, total: 0, items: [{ query: "pan", product: null }] },
      ],
      cheapest: undefined,
      comparability: [{ query: "pan", confidence: "similar", chosen: [] }],
      disclaimer: "x",
    };

    const b = chooseCheapestBasket(cmp);
    expect(b.missing).toEqual(["pan"]);
    expect(b.picks).toEqual([]);
    expect(b.plan).toEqual([]);
    expect(b.basketTotal).toBe(0);
    expect(b.singleStore).toBeUndefined();
    expect(b.splitSaving).toBe(0);
  });

  it("cae a precio absoluto cuando no todos los candidatos traen precio/unidad", () => {
    const cmp: CompareResult = {
      items: ["leche"],
      stores: [
        {
          store: "jumbo",
          matched: 1,
          total: 1000,
          items: [{ query: "leche", product: prod({ store: "jumbo", price: 1000, unitPrice: 1000, unit: "lt" }) }],
        },
        {
          store: "unimarc",
          matched: 1,
          total: 900,
          items: [{ query: "leche", product: prod({ store: "unimarc", price: 900 }) }], // sin unitPrice
        },
      ],
      cheapest: "unimarc",
      comparability: [{ query: "leche", confidence: "similar", chosen: [] }],
      disclaimer: "x",
    };

    const b = chooseCheapestBasket(cmp);
    expect(b.picks[0]!.by).toBe("price");
    expect(b.picks[0]!.store).toBe("unimarc");
    expect(b.picks[0]!.price).toBe(900);
  });
});
