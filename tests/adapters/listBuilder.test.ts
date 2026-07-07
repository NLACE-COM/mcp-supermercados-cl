import { describe, expect, it } from "vitest";
import type { StoreAdapter } from "../../src/adapters/base.js";
import {
  buildList,
  matchFrequent,
  rankCandidates,
  suggestSwaps,
} from "../../src/core/listBuilder.js";
import type { Product, SearchOpts } from "../../src/core/types.js";

function product(overrides: Partial<Product> & { id: string }): Product {
  return {
    store: "jumbo",
    name: `Producto ${overrides.id}`,
    price: 1000,
    inStock: true,
    fetchedAt: new Date().toISOString(),
    ...overrides,
  } as Product;
}

/** Adaptador falso: devuelve resultados fijos por query. */
function fakeAdapter(resultsByQuery: Record<string, Product[]>): StoreAdapter {
  return {
    id: "jumbo",
    async searchProducts(query: string, _opts?: SearchOpts) {
      return resultsByQuery[query] ?? [];
    },
  } as StoreAdapter;
}

describe("rankCandidates", () => {
  it("prefiere menor precio por unidad dentro de la unidad predominante", () => {
    const ranked = rankCandidates([
      product({ id: "caro", price: 2000, unitPrice: 2000, unit: "kg" }),
      product({ id: "barato", price: 1500, unitPrice: 1500, unit: "kg" }),
      product({ id: "otro-formato", price: 500, unitPrice: 5000, unit: "kg" }),
    ]);
    expect(ranked.map((p) => p.id)).toEqual(["barato", "caro", "otro-formato"]);
  });

  it("descarta productos sin stock", () => {
    const ranked = rankCandidates([
      product({ id: "sin-stock", inStock: false, unitPrice: 100, unit: "kg" }),
      product({ id: "con-stock", unitPrice: 900, unit: "kg" }),
    ]);
    expect(ranked.map((p) => p.id)).toEqual(["con-stock"]);
  });

  it("sin precios por unidad ordena por precio absoluto", () => {
    const ranked = rankCandidates([
      product({ id: "a", price: 3000 }),
      product({ id: "b", price: 1000 }),
    ]);
    expect(ranked.map((p) => p.id)).toEqual(["b", "a"]);
  });
});

describe("buildList", () => {
  it("resuelve ítems, suma total y ahorro por ofertas", async () => {
    const adapter = fakeAdapter({
      leche: [
        product({
          id: "l1",
          price: 1000,
          listPrice: 1200,
          unitPrice: 1000,
          unit: "lt",
        }),
        product({ id: "l2", price: 1500, unitPrice: 1500, unit: "lt" }),
      ],
      arroz: [
        product({
          id: "a1",
          price: 1790,
          listPrice: 2440,
          unitPrice: 1790,
          unit: "kg",
        }),
      ],
    });

    const result = await buildList(adapter, ["leche", "arroz"]);

    expect(result.items[0].chosen?.id).toBe("l1");
    expect(result.items[0].alternatives.map((p) => p.id)).toEqual(["l2"]);
    expect(result.total).toBe(1000 + 1790);
    expect(result.totalSaving).toBe(200 + 650);
  });

  it("ítem sin resultados queda con nota y no rompe el total", async () => {
    const adapter = fakeAdapter({
      leche: [product({ id: "l1", price: 990, unitPrice: 990, unit: "lt" })],
    });
    const result = await buildList(adapter, ["leche", "unicornio"]);

    expect(result.items[1].chosen).toBeNull();
    expect(result.items[1].note).toMatch(/Sin resultados/);
    expect(result.total).toBe(990);
  });
});

describe("matchFrequent", () => {
  const frequent = [
    product({
      id: "f1",
      name: "Arroz Grado 2 Cuisine & Co 1 kg",
      price: 1390,
      unitPrice: 1390,
      unit: "kg",
    }),
    product({
      id: "f2",
      name: "Leche Colun Entera 1 L",
      price: 1090,
      unitPrice: 1090,
      unit: "lt",
    }),
  ];

  it("matchea cuando todas las palabras de la query están en el nombre", () => {
    expect(matchFrequent("arroz", frequent)?.id).toBe("f1");
    expect(matchFrequent("leche colun", frequent)?.id).toBe("f2");
  });

  it("no matchea si falta una palabra significativa", () => {
    expect(matchFrequent("leche descremada", frequent)).toBeUndefined();
  });

  it("ignora productos frecuentes sin stock", () => {
    const sinStock = [product({ id: "x", name: "Pan Molde", inStock: false })];
    expect(matchFrequent("pan", sinStock)).toBeUndefined();
  });
});

describe("buildList con frecuentes (fase 2)", () => {
  it("prioriza el producto frecuente aunque el buscador rankee otro primero", async () => {
    const adapter = fakeAdapter({
      arroz: [
        product({
          id: "barato",
          name: "Arroz Marca X 1 kg",
          price: 990,
          unitPrice: 990,
          unit: "kg",
        }),
        product({
          id: "f1",
          name: "Arroz Grado 2 Cuisine & Co 1 kg",
          price: 1390,
          unitPrice: 1390,
          unit: "kg",
        }),
      ],
    });
    const frequentProducts = [
      product({
        id: "f1",
        name: "Arroz Grado 2 Cuisine & Co 1 kg",
        price: 1390,
        unitPrice: 1390,
        unit: "kg",
        memberPrice: 1290,
      }),
    ];

    const result = await buildList(adapter, ["arroz"], { frequentProducts });
    expect(result.items[0].chosen?.id).toBe("f1");
    expect(result.items[0].fromFrequent).toBe(true);
    // el más barato del buscador queda como alternativa
    expect(result.items[0].alternatives.map((p) => p.id)).toContain("barato");
  });

  it("sin match en frecuentes usa el ranking público normal", async () => {
    const adapter = fakeAdapter({
      detergente: [
        product({
          id: "d1",
          name: "Detergente Omo 3 kg",
          price: 8990,
          unitPrice: 2996,
          unit: "kg",
        }),
      ],
    });
    const frequentProducts = [
      product({ id: "f1", name: "Arroz Cuisine & Co 1 kg", price: 1390 }),
    ];
    const result = await buildList(adapter, ["detergente"], { frequentProducts });
    expect(result.items[0].chosen?.id).toBe("d1");
    expect(result.items[0].fromFrequent).toBeUndefined();
  });
});

describe("buildList con flags onlyOffers/onlyInStock", () => {
  it("onlyOffers elige solo productos con descuento", async () => {
    const adapter = fakeAdapter({
      arroz: [
        product({ id: "sinoferta", price: 1000, unitPrice: 1000, unit: "kg" }),
        product({
          id: "oferta",
          price: 900,
          listPrice: 1200,
          unitPrice: 900,
          unit: "kg",
        }),
      ],
    });
    const result = await buildList(adapter, ["arroz"], { onlyOffers: true });
    expect(result.items[0].chosen?.id).toBe("oferta");
  });

  it("onlyOffers sin ofertas deja el ítem sin match con nota", async () => {
    const adapter = fakeAdapter({
      arroz: [product({ id: "sinoferta", price: 1000, unitPrice: 1000, unit: "kg" })],
    });
    const result = await buildList(adapter, ["arroz"], { onlyOffers: true });
    expect(result.items[0].chosen).toBeNull();
    expect(result.items[0].note).toMatch(/oferta/i);
  });

  it("onlyInStock descarta productos sin stock", async () => {
    const adapter = fakeAdapter({
      pan: [
        product({ id: "sinstock", price: 500, inStock: false }),
        product({ id: "constock", price: 900, inStock: true }),
      ],
    });
    const result = await buildList(adapter, ["pan"], { onlyInStock: true });
    expect(result.items[0].chosen?.id).toBe("constock");
  });

  it("onlyOffers ignora un frecuente que no está en oferta", async () => {
    const adapter = fakeAdapter({
      arroz: [
        product({
          id: "oferta",
          price: 900,
          listPrice: 1200,
          unitPrice: 900,
          unit: "kg",
        }),
      ],
    });
    const frequentProducts = [
      product({
        id: "freq",
        name: "arroz freq",
        price: 1000,
        unitPrice: 1000,
        unit: "kg",
      }),
    ];
    const result = await buildList(adapter, ["arroz"], {
      onlyOffers: true,
      frequentProducts,
    });
    // el frecuente no está en oferta => se cae al de oferta del catálogo
    expect(result.items[0].chosen?.id).toBe("oferta");
    expect(result.items[0].fromFrequent).toBeUndefined();
  });
});

describe("suggestSwaps", () => {
  it("sugiere solo alternativas con mejor precio por unidad que el match actual", async () => {
    const adapter = fakeAdapter({
      "arroz tucapel": [
        product({ id: "actual", price: 2450, unitPrice: 2450, unit: "kg" }),
        product({ id: "mas-barato", price: 1890, unitPrice: 1890, unit: "kg" }),
        product({ id: "mas-caro", price: 2690, unitPrice: 2690, unit: "kg" }),
        product({ id: "otra-unidad", price: 100, unitPrice: 100, unit: "un" }),
      ],
    });

    const result = await suggestSwaps(adapter, "arroz tucapel");

    expect(result.current?.id).toBe("actual");
    expect(result.swaps.map((s) => s.id)).toEqual(["mas-barato"]);
    expect(result.swaps[0].savingPerUnit).toBe(560);
  });

  it("sin precio por unidad comparable devuelve nota", async () => {
    const adapter = fakeAdapter({
      pan: [product({ id: "p1", price: 1000 })],
    });
    const result = await suggestSwaps(adapter, "pan");
    expect(result.swaps).toEqual([]);
    expect(result.note).toMatch(/precio por unidad/);
  });

  it("preferNatural incluye alternativas de precio similar con ingredientes", async () => {
    const actual = product({
      id: "actual",
      name: "Cereal Choco 300 g",
      price: 3000,
      unitPrice: 10000,
      unit: "kg",
      url: "https://x/actual/p",
    });
    const similar = product({
      id: "similar",
      name: "Cereal Natural 300 g",
      price: 3100,
      unitPrice: 10333,
      unit: "kg",
      url: "https://x/similar/p",
    });
    const detailById: Record<string, string[]> = {
      actual: ["maíz", "azúcar", "cacao", "saborizante", "colorante"],
      similar: ["avena integral"],
    };
    const adapter = {
      id: "jumbo",
      async searchProducts() {
        return [actual, similar];
      },
      async getProduct(url: string) {
        const id = url.includes("similar") ? "similar" : "actual";
        return {
          ...(id === "similar" ? similar : actual),
          ingredients: detailById[id],
        };
      },
    } as unknown as StoreAdapter;

    const result = await suggestSwaps(adapter, "cereal", { preferNatural: true });
    expect(result.current?.ingredients).toEqual(detailById.actual);
    expect(result.swaps[0].id).toBe("similar");
    expect(result.swaps[0].ingredients).toEqual(["avena integral"]);
  });
});
