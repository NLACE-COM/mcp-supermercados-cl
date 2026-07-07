import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CencosudAdapter, JUMBO_CONFIG } from "../../src/adapters/cencosud.js";
import {
  listItemToProduct,
  listsToProducts,
  parseShoppingLists,
} from "../../src/adapters/cencosudLists.js";
import { ProductSchema, ShoppingListSchema } from "../../src/core/types.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = JSON.parse(
  readFileSync(join(fixturesDir, "jumbo-list-2026-07-07.json"), "utf-8")
);
const rawList = fixture.list;

describe("listItemToProduct", () => {
  it("normaliza item con precio Prime (Salame)", () => {
    const salame = rawList.items[1];
    const p = listItemToProduct(salame, "jumbo")!;
    ProductSchema.parse(p);
    expect(p.price).toBe(1472);
    expect(p.listPrice).toBe(1840);
    expect(p.memberPrice).toBe(1288); // promo PRIME_USER
    expect(p.unit).toBe("kg");
  });

  it("item sin promo Prime no expone memberPrice", () => {
    const yogurt = rawList.items[0];
    const p = listItemToProduct(yogurt, "jumbo")!;
    expect(p.price).toBe(720);
    expect(p.memberPrice).toBeUndefined();
  });
});

describe("parseShoppingLists", () => {
  it("normaliza una lista con sus items", () => {
    const lists = parseShoppingLists(rawList, "jumbo");
    expect(lists).toHaveLength(1);
    ShoppingListSchema.parse(lists[0]);
    expect(lists[0].name).toBe("Productos frecuentes");
    expect(lists[0].id).toBe("p6LE_3Xq8_tlayZN_NPc7");
    expect(lists[0].items.length).toBe(2);
    expect(lists[0].items[0].productId).toBe("165423");
  });

  it("acepta un arreglo de listas y JSON vacío", () => {
    expect(parseShoppingLists([rawList, rawList], "jumbo")).toHaveLength(2);
    expect(parseShoppingLists(null, "jumbo")).toEqual([]);
  });
});

describe("listsToProducts", () => {
  it("aplana los productos de las listas", () => {
    const products = listsToProducts(rawList, "jumbo");
    expect(products.length).toBe(2);
    for (const p of products) ProductSchema.parse(p);
  });
});

describe("CencosudAdapter · getSavedLists", () => {
  const adapter = new CencosudAdapter(JUMBO_CONFIG);

  it("con savedListsRaw devuelve las listas normalizadas", async () => {
    const lists = await adapter.getSavedLists({
      store: "jumbo",
      branchId: "jumboclj512",
      savedListsRaw: rawList,
    });
    expect(lists).toHaveLength(1);
    expect(lists[0].items).toHaveLength(2);
  });

  it("sin material de sesión explica cómo habilitarlo", async () => {
    await expect(
      adapter.getSavedLists({ store: "jumbo" })
    ).rejects.toThrow(/savedListsRaw|localStorage/);
  });
});
