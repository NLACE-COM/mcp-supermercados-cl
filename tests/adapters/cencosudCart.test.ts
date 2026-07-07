import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CencosudAdapter, JUMBO_CONFIG } from "../../src/adapters/cencosud.js";
import {
  buildCartPatchBody,
  cartItemToProduct,
  parseCart,
} from "../../src/adapters/cencosudCart.js";
import { CartSchema, ProductSchema, type CartBridge } from "../../src/core/types.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const cartFixture = JSON.parse(
  readFileSync(join(fixturesDir, "cart-2026-07-07.json"), "utf-8")
);
const rawCart = cartFixture.cart;

describe("cartItemToProduct", () => {
  it("normaliza un item con precio socio Prime (Yogurt)", () => {
    const yogurt = rawCart.items[0];
    const p = cartItemToProduct(yogurt, "jumbo")!;
    ProductSchema.parse(p);
    expect(p.name).toContain("Yogurt");
    expect(p.price).toBe(675); // prices.price (vigente)
    expect(p.listPrice).toBe(900); // prices.listPrice
    expect(p.memberPrice).toBe(675); // promo PRIME_USER
  });

  it("item sin promo Prime no expone memberPrice", () => {
    const spaghetti = rawCart.items[1];
    const p = cartItemToProduct(spaghetti, "jumbo")!;
    expect(p.memberPrice).toBeUndefined();
    expect(p.price).toBe(750);
  });
});

describe("parseCart", () => {
  it("normaliza el carro real con totales y ahorro Prime", () => {
    const cart = parseCart(rawCart, "jumbo");
    CartSchema.parse(cart);

    expect(cart.itemsQuantity).toBe(66);
    expect(cart.subTotal).toBe(169041);
    expect(cart.total).toBe(149712);
    expect(cart.savings).toBe(169041 - 149712);
    expect(cart.primeSavings).toBe(3456); // |PRIME_USER discount|
    expect(cart.items).toHaveLength(2);
    expect(cart.items[0].lineTotal).toBe(5400); // totalPrice del yogurt
  });

  it("carro vacío/desconocido no revienta", () => {
    const cart = parseCart({}, "jumbo");
    CartSchema.parse(cart);
    expect(cart.items).toHaveLength(0);
    expect(cart.total).toBe(0);
    expect(cart.savings).toBe(0);
  });
});

describe("buildCartPatchBody", () => {
  it("arma el body del PATCH /cart/items como el frontend", () => {
    const body = buildCartPatchBody(
      [{ skuId: "92628", quantity: 3, measurementUnitUn: "kg", unitMultiplierUn: 1 }],
      "jumboclj512"
    );
    expect(body.store).toBe("jumboclj512");
    expect(body.items[0]).toMatchObject({
      skuId: "92628",
      quantity: 3,
      isUnitary: false,
      giftable: false,
      measurementUnitUn: "kg",
      soldBy: "Jumbo",
    });
  });
});

describe("CencosudAdapter · carro (puente de sesión)", () => {
  const adapter = new CencosudAdapter(JUMBO_CONFIG);

  function fakeBridge(): CartBridge & { patched: unknown[] } {
    const patched: unknown[] = [];
    return {
      patched,
      async readCart() {
        return rawCart;
      },
      async patchItems(items) {
        patched.push(items);
        return rawCart;
      },
    };
  }

  it("getCart normaliza vía el puente", async () => {
    const bridge = fakeBridge();
    const cart = await adapter.getCart({
      store: "jumbo",
      branchId: "jumboclj512",
      cartBridge: bridge,
    });
    CartSchema.parse(cart);
    expect(cart.total).toBe(149712);
  });

  it("addToCart manda skuId+quantity al puente y devuelve el carro", async () => {
    const bridge = fakeBridge();
    const cart = await adapter.addToCart([{ productId: "92628", quantity: 2 }], {
      store: "jumbo",
      branchId: "jumboclj512",
      cartBridge: bridge,
    });
    expect(bridge.patched).toHaveLength(1);
    expect((bridge.patched[0] as any)[0]).toEqual({ skuId: "92628", quantity: 2 });
    CartSchema.parse(cart);
  });

  it("sin puente de carro explica cómo habilitarlo", async () => {
    await expect(
      adapter.getCart({ store: "jumbo", branchId: "jumboclj512" })
    ).rejects.toThrow(/puente de carro|cartBridge/);
  });

  it("sin branchId falla con mensaje claro", async () => {
    await expect(
      adapter.getCart({ store: "jumbo", cartBridge: fakeBridge() })
    ).rejects.toThrow(/branchId/);
  });
});
