import { describe, expect, it } from "vitest";
import { formatClp, priceScopeInfo, savingPct } from "../../src/core/format.js";

describe("formatClp", () => {
  it("formatea CLP con puntos de miles", () => {
    expect(formatClp(12345)).toBe("$12.345");
    expect(formatClp(1000000)).toBe("$1.000.000");
    expect(formatClp(999)).toBe("$999");
    expect(formatClp(0)).toBe("$0");
  });

  it("maneja negativos y valores inválidos", () => {
    expect(formatClp(-1500)).toBe("-$1.500");
    expect(formatClp(undefined)).toBe("—");
    expect(formatClp(NaN)).toBe("—");
  });
});

describe("savingPct", () => {
  it("calcula el porcentaje de ahorro redondeado", () => {
    expect(savingPct(200, 1000)).toBe(20);
    expect(savingPct(0, 1000)).toBe(0);
    expect(savingPct(100, 0)).toBe(0);
  });
});

describe("priceScopeInfo", () => {
  it("con sucursal: alcance sucursal, sin nota", () => {
    expect(priceScopeInfo("jumboclj512")).toEqual({ priceScope: "sucursal" });
  });

  it("sin sucursal: alcance nacional con nota que guía a discover_branch", () => {
    const info = priceScopeInfo(undefined);
    expect(info.priceScope).toBe("nacional");
    expect(info.priceScopeNote).toContain("catálogo nacional");
    expect(info.priceScopeNote).toContain("discover_branch");
  });
});
