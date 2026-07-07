import { describe, expect, it } from "vitest";
import {
  matchScore,
  matchesQuery,
  singularize,
  tokens,
} from "../../src/core/matching.js";

describe("singularize", () => {
  it("quita plurales comunes", () => {
    expect(singularize("paltas")).toBe("palta");
    expect(singularize("huevos")).toBe("huevo");
    expect(singularize("bebidas")).toBe("bebida");
    expect(singularize("lapices")).toBe("lapiz");
  });

  it("no rompe palabras cortas ni no-plurales", () => {
    expect(singularize("gas")).toBe("gas");
    expect(singularize("mes")).toBe("mes");
    expect(singularize("arroz")).toBe("arroz");
    expect(singularize("queso")).toBe("queso");
  });
});

describe("tokens", () => {
  it("normaliza, quita stopwords y singulariza", () => {
    expect(tokens("Leche de las Vacas")).toEqual(["leche", "vaca"]);
    expect(tokens("café")).toEqual(["cafe"]);
  });
});

describe("matchScore / matchesQuery", () => {
  it("matchea ignorando tildes y plurales", () => {
    expect(matchesQuery("cafe", "Café de grano")).toBe(true);
    expect(matchesQuery("huevos", "Huevo blanco docena")).toBe(true);
    expect(matchesQuery("leche descremada", "Leche Descremada 1L")).toBe(true);
  });

  it("resuelve sinónimos y regionalismos chilenos", () => {
    expect(matchesQuery("palta", "Aguacate Hass unidad")).toBe(true);
    expect(matchesQuery("bebida", "Gaseosa Coca-Cola 1.5L")).toBe(true);
    expect(matchesQuery("frutilla", "Fresas en malla 250 g")).toBe(true);
    expect(matchesQuery("confort", "Papel Higiénico doble hoja")).toBe(true);
  });

  it("exige cubrir todos los tokens de la query", () => {
    // "leche" cubre, pero "almendras" no aparece => no matchea al 100%.
    expect(matchesQuery("leche almendras", "Leche entera 1L")).toBe(false);
    expect(matchScore("leche almendras", "Leche entera 1L")).toBeCloseTo(0.5);
  });

  it("no confunde substrings peligrosos", () => {
    // "agua" NO debe matchear "aguacate".
    expect(matchesQuery("agua", "Aguacate Hass")).toBe(false);
    // "leche" NO debe matchear "lechuga".
    expect(matchesQuery("leche", "Lechuga costina")).toBe(false);
  });

  it("acepta parcial con umbral menor para queries largas", () => {
    expect(matchesQuery("yogurt griego natural", "Yogurt Griego", 0.6)).toBe(true);
  });
});
