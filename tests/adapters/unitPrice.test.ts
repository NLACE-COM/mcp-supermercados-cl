import { describe, expect, it } from "vitest";
import {
  normalizeUnit,
  normalizeUnitPrice,
  parseUnitPriceString,
} from "../../src/core/normalize.js";

describe("parseUnitPriceString · normalización a base comparable", () => {
  it("mantiene por litro y por kilo", () => {
    expect(parseUnitPriceString("$2.500 x litro")).toEqual({
      unitPrice: 2500,
      unit: "lt",
    });
    expect(parseUnitPriceString("$1.190 x kg")).toEqual({
      unitPrice: 1190,
      unit: "kg",
    });
    expect(parseUnitPriceString("$1.097 por LT")).toEqual({
      unitPrice: 1097,
      unit: "lt",
    });
  });

  it("convierte 100ml a por litro (el caso que confundía la comparación)", () => {
    // "$1.048 x 100ml" = $10.480 por litro
    expect(parseUnitPriceString("$1.048 x 100ml")).toEqual({
      unitPrice: 10480,
      unit: "lt",
    });
  });

  it("convierte gramos a por kilo", () => {
    expect(parseUnitPriceString("$700 x 100 g")).toEqual({
      unitPrice: 7000,
      unit: "kg",
    });
    expect(parseUnitPriceString("$1.500 x 250 g")).toEqual({
      unitPrice: 6000,
      unit: "kg",
    });
  });

  it("texto sin patrón -> undefined", () => {
    expect(parseUnitPriceString("gratis")).toBeUndefined();
    expect(parseUnitPriceString(null)).toBeUndefined();
  });
});

describe("normalizeUnitPrice", () => {
  it("g/ml se llevan a kg/lt escalando el precio", () => {
    expect(normalizeUnitPrice(720, 155, "g")).toEqual({
      unitPrice: Math.round(720 / (155 / 1000)),
      unit: "kg",
    });
    expect(normalizeUnitPrice(500, 500, "ml")).toEqual({ unitPrice: 1000, unit: "lt" });
  });

  it("permite comparar dos formatos de Coca-Cola", () => {
    // 3 L a $3.290 -> por litro; 1 L a $1.490 -> por litro
    const tresLitros = normalizeUnitPrice(3290, 3, "lt");
    const unLitro = normalizeUnitPrice(1490, 1, "lt");
    expect(tresLitros.unitPrice).toBe(1097); // el 3L conviene por litro
    expect(unLitro.unitPrice).toBe(1490);
    expect(tresLitros.unitPrice).toBeLessThan(unLitro.unitPrice);
  });
});

describe("normalizeUnit", () => {
  it("colapsa g->kg y ml->lt", () => {
    expect(normalizeUnit("g")).toBe("kg");
    expect(normalizeUnit("gramos")).toBe("kg");
    expect(normalizeUnit("ml")).toBe("lt");
    expect(normalizeUnit("KG")).toBe("kg");
    expect(normalizeUnit("Litros")).toBe("lt");
  });
});
