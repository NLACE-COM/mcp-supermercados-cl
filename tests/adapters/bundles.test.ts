import { describe, expect, it } from "vitest";
import { parseBundle } from "../../src/core/normalize.js";
import { LiderAdapter } from "../../src/adapters/lider.js";
import { TottusAdapter } from "../../src/adapters/tottus.js";
import { UnimarcAdapter } from "../../src/adapters/unimarc.js";
import { ProductSchema } from "../../src/core/types.js";

describe("parseBundle", () => {
  it("reconoce 'Combina N x $X'", () => {
    expect(parseBundle("Combina 2 x $4.890")).toEqual({
      description: "Combina 2 x $4.890",
      type: "bundle",
      minQuantity: 2,
      bundlePrice: 4890,
      unitPriceInBundle: 2445,
    });
  });

  it("reconoce 'Lleva N por $X' y 'N X $X'", () => {
    expect(parseBundle("Lleva 8 por $5.600")).toMatchObject({
      minQuantity: 8,
      bundlePrice: 5600,
      unitPriceInBundle: 700,
    });
    expect(parseBundle("2 X $2.000")).toMatchObject({
      minQuantity: 2,
      bundlePrice: 2000,
      unitPriceInBundle: 1000,
    });
  });

  it("reconoce NxM (2x1) sin precio", () => {
    expect(parseBundle("2x1")).toMatchObject({ type: "nxm", minQuantity: 2 });
  });

  it("texto vacío o null -> undefined", () => {
    expect(parseBundle("")).toBeUndefined();
    expect(parseBundle(null)).toBeUndefined();
  });
});

describe("Lider · bundles desde badges.flags", () => {
  it("mapea el flag COMBINA a promotions", () => {
    const p = new LiderAdapter().mapProduct({
      usItemId: "1",
      name: "Coca-Cola 3 L",
      priceInfo: { linePrice: "$3.190" },
      badges: {
        flags: [
          { key: "COMBINA", text: "Combina 2 x $4.890", type: "LABEL" },
          { key: "ROLLBACK", text: "Rebaja", type: "ICON" }, // no es bundle
        ],
      },
    } as never)!;
    ProductSchema.parse(p);
    expect(p.promotions).toHaveLength(1);
    expect(p.promotions![0]).toMatchObject({
      minQuantity: 2,
      bundlePrice: 4890,
      unitPriceInBundle: 2445,
    });
  });
});

describe("Unimarc · bundles desde promotion", () => {
  it("usa itemsRequiredForPromotion y price efectivo", () => {
    const p = new UnimarcAdapter().mapProduct({
      price: { price: "$2.000", listPrice: "$2.000" },
      item: { sku: "9", name: "Coca Cola 1 L", brand: "Coca-cola" },
      promotion: {
        hasSavings: true,
        descriptionMessage: "2 x $2.000",
        itemsRequiredForPromotion: 2,
        price: 1000,
        type: "mx$",
      },
    } as never)!;
    ProductSchema.parse(p);
    expect(p.promotions![0]).toMatchObject({
      description: "2 x $2.000",
      minQuantity: 2,
      unitPriceInBundle: 1000,
      bundlePrice: 2000,
    });
  });
});

describe("Tottus · bundles desde multipurposeBadges", () => {
  it("usa totalQuantityToBuy y el label", () => {
    const p = new TottusAdapter().mapProduct({
      productId: "1",
      skuId: "1",
      displayName: "Coca Cola 1.5 L",
      brand: "COCA-COLA",
      prices: [{ type: "internetPrice", price: ["1200"] }],
      multipurposeBadges: [
        { label: "2 X $2000", promotionData: { totalQuantityToBuy: "2" } },
      ],
    } as never)!;
    ProductSchema.parse(p);
    expect(p.promotions![0]).toMatchObject({
      minQuantity: 2,
      bundlePrice: 2000,
      unitPriceInBundle: 1000,
    });
  });
});
