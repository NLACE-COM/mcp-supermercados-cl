import { describe, expect, it } from "vitest";
import {
  jumboDiscoverBranchSnippet,
  jumboFetchSnippet,
  jumboFrequentCardsSnippet,
  jumboMutateSnippet,
} from "../../src/adapters/cencosudBrowser.js";

/**
 * Los snippets se ejecutan en el navegador del usuario: si no son JS válido,
 * el flujo de sesión se rompe. Aquí solo verificamos que parsean (sintaxis)
 * y que llevan los marcadores clave; no los ejecutamos (usan fetch/DOM).
 */
function isParseableAsyncBody(code: string): boolean {
  try {
    // Envuelto en async porque los snippets usan top-level await.
    new Function(`return (async () => { ${code} })`);
    return true;
  } catch {
    return false;
  }
}

describe("snippets de navegador Cencosud", () => {
  it("jumboFetchSnippet genera JS válido con el path y la sesión", () => {
    const code = jumboFetchSnippet(
      "/cart?store=jumboclj512&simulationTotals=true",
      "cart"
    );
    expect(isParseableAsyncBody(code)).toBe(true);
    expect(code).toContain("/cart?store=jumboclj512");
    expect(code).toContain("sessionDataToken");
    expect(code).toContain('credentials: "include"');
    // No debe empujar a raspar el DOM ni React.
    expect(code).not.toMatch(/querySelector|__REACT|reactProps/);
  });

  it("jumboMutateSnippet incluye method y body serializado", () => {
    const body = { items: [{ skuId: "92628", quantity: 3 }], store: "jumboclj512" };
    const code = jumboMutateSnippet("/cart/items", "PATCH", body, "cart");
    expect(isParseableAsyncBody(code)).toBe(true);
    expect(code).toContain('"PATCH"');
    expect(code).toContain("92628");
    expect(code).toContain("Content-Type");
    expect(code).toContain('credentials: "include"');
  });

  it("usa solo headers admitidos por el preflight CORS actual de Jumbo", () => {
    const code = jumboMutateSnippet("/cart/items", "PATCH", { items: [] }, "cart");

    expect(code).toContain('"Authorization"');
    expect(code).toContain('"apiKey"');
    expect(code).not.toContain('"token"');
    expect(code).not.toContain('"x-consumer"');
    expect(code).not.toContain('"x-e-commerce"');
    expect(code).not.toContain('"x-account"');
    expect(code).toContain('"x-client-platform"');
    expect(code).toContain('"x-client-version"');
    expect(code).toContain('"x-trace-id"');
  });

  /**
   * Cada servicio del BFF valida SU apiKey: mandar la del carro a /lists (lo
   * que pasaba al compartir una sola constante) rompe las listas guardadas.
   */
  it("manda la apiKey del servicio que sirve el path, no una compartida", () => {
    const cart = jumboFetchSnippet("/cart?store=jumboclj512", "cart");
    const lists = jumboFetchSnippet("/lists?store=jumboclj512", "lists");

    expect(cart).toContain("be-reg-groceries-jumbo-cart-rhk68rqi0adn");
    expect(cart).not.toContain("be-reg-groceries-jumbo-lists-9f222055975d");

    expect(lists).toContain("be-reg-groceries-jumbo-lists-9f222055975d");
    expect(lists).not.toContain("be-reg-groceries-jumbo-cart-rhk68rqi0adn");
  });

  // `salesChannel` (VTEX legacy). Se mandaba a todo el BFF hasta 2026-07-14.
  it("no reusa la apiKey legacy de salesChannel", () => {
    for (const code of [
      jumboFetchSnippet("/cart", "cart"),
      jumboFetchSnippet("/lists", "lists"),
      jumboMutateSnippet("/cart/items", "PATCH", { items: [] }, "cart"),
    ]) {
      expect(code).not.toContain("WnOIGTaOkfFwotM8Ddw2");
    }
  });

  it("jumboFrequentCardsSnippet extrae cards del DOM en una pasada", () => {
    const code = jumboFrequentCardsSnippet();
    expect(isParseableAsyncBody(code)).toBe(true);
    expect(code).toContain("data-cnstrc-item-id");
    // Debe traer los campos que el parser espera.
    for (const field of ["id", "name", "dataPrice", "href", "tachado", "prime"]) {
      expect(code).toContain(field);
    }
  });

  it("jumboDiscoverBranchSnippet lee la sucursal del navegador", () => {
    const code = jumboDiscoverBranchSnippet();
    expect(isParseableAsyncBody(code)).toBe(true);
    expect(code).toContain("delivery-method-state");
    // Devuelve found:true con branchId, o found:false con una pista.
    expect(code).toContain("found");
    expect(code).toContain("branchId");
  });
});
