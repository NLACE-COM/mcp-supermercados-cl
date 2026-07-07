import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CencosudAdapter, JUMBO_CONFIG } from "../../src/adapters/cencosud.js";
import {
  extractFrequentCardsFromHtml,
  parseClp,
  parseFrequentCard,
  parsePpu,
} from "../../src/adapters/cencosudSession.js";
import { dataSession } from "../../src/adapters/session.js";
import { ProductSchema, type FrequentCard } from "../../src/core/types.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const frequentFixture = JSON.parse(
  readFileSync(join(fixturesDir, "frequent-products-2026-07-07.json"), "utf-8")
);
const cards = frequentFixture.products as FrequentCard[];

describe("parseClp", () => {
  it("parsea montos CLP con separador de miles", () => {
    expect(parseClp("$1.288")).toBe(1288);
    expect(parseClp("$14.720 x kg")).toBe(14720);
    expect(parseClp("720")).toBe(720);
    expect(parseClp(null)).toBeUndefined();
    expect(parseClp("Paga $1.288")).toBe(1288);
  });
});

describe("parsePpu", () => {
  it("extrae precio por unidad y unidad", () => {
    expect(parsePpu("$14.720 x kg")).toEqual({ unitPrice: 14720, unit: "kg" });
    expect(parsePpu("$7.720 x lt")).toEqual({ unitPrice: 7720, unit: "lt" });
    expect(parsePpu(undefined)).toBeUndefined();
  });
});

describe("parseFrequentCard · productos frecuentes reales", () => {
  it("mapea el Salame con precio Prime (el caso de la foto del usuario)", () => {
    const salame = cards.find((c) => c.id === "11149")!;
    const p = parseFrequentCard(salame, "jumbo", JUMBO_CONFIG.siteBaseUrl)!;
    ProductSchema.parse(p);

    expect(p.name).toContain("Salame");
    expect(p.price).toBe(1472); // vigente
    expect(p.listPrice).toBe(1840); // tachado
    expect(p.memberPrice).toBe(1288); // "Paga $1.288" Prime
    expect(p.unit).toBe("kg");
    expect(p.unitPrice).toBe(14720);
    expect(p.offer?.type).toBe("descuento");
    expect(p.url).toBe(
      "https://www.jumbo.cl/salame-artesanal-receta-del-abuelo-granel/p"
    );
  });

  it("usa dataPrice (no el nodo vigente pegado) para el precio", () => {
    // El Queso trae vigente "$5.690$6.230" pegado; dataPrice=5690 es lo correcto.
    const queso = cards.find((c) => c.id === "10805")!;
    const p = parseFrequentCard(queso, "jumbo", JUMBO_CONFIG.siteBaseUrl)!;
    expect(p.price).toBe(5690);
    expect(p.listPrice).toBe(6230);
  });

  it("producto sin oferta ni prime no inventa listPrice/memberPrice", () => {
    const arroz = cards.find((c) => c.id === "92628")!;
    const p = parseFrequentCard(arroz, "jumbo", JUMBO_CONFIG.siteBaseUrl)!;
    expect(p.price).toBe(1390);
    expect(p.listPrice).toBeUndefined();
    expect(p.memberPrice).toBeUndefined();
    expect(p.unit).toBe("kg");
  });

  it("extrae la marca del innerText", () => {
    const vino = cards.find((c) => c.id === "11947")!;
    const p = parseFrequentCard(vino, "jumbo", JUMBO_CONFIG.siteBaseUrl)!;
    expect(p.brand).toBe("Caliterra");
  });

  it("todos los frecuentes de la fixture son Product válidos", () => {
    for (const card of cards) {
      const p = parseFrequentCard(card, "jumbo", JUMBO_CONFIG.siteBaseUrl);
      expect(p).not.toBeNull();
      ProductSchema.parse(p);
    }
  });
});

describe("extractFrequentCardsFromHtml", () => {
  it("extrae cards desde el markup con data-cnstrc-item-*", () => {
    const html = `
      <div data-cnstrc-item-name="Arroz Grado 1 Tucapel 1 kg" data-cnstrc-item-id="123" data-cnstrc-item-price="2450">...</div>
      <div data-cnstrc-item-name="Leche Colun 1 L" data-cnstrc-item-id="456" data-cnstrc-item-price="1290">...</div>
    `;
    const extracted = extractFrequentCardsFromHtml(html);
    expect(extracted).toHaveLength(2);
    expect(extracted[0]).toMatchObject({
      id: "123",
      name: "Arroz Grado 1 Tucapel 1 kg",
      dataPrice: "2450",
    });
  });
});

describe("CencosudAdapter · getFrequentPurchases", () => {
  const adapter = new CencosudAdapter(JUMBO_CONFIG);

  it("con sesión de datos devuelve los frecuentes normalizados", async () => {
    const session = dataSession("jumbo", {
      branchId: "jumboclj512",
      frequentCards: cards,
    });
    const products = await adapter.getFrequentPurchases(session);

    expect(products.length).toBe(cards.length);
    for (const p of products) ProductSchema.parse(p);
    const salame = products.find((p) => p.id === "11149")!;
    expect(salame.memberPrice).toBe(1288);
  });

  it("con puente de navegador parsea el HTML autenticado", async () => {
    const html = `
      <div data-cnstrc-item-name="Producto A" data-cnstrc-item-id="1" data-cnstrc-item-price="1000">x</div>
    `;
    const session = {
      store: "jumbo" as const,
      fetchAuthedHtml: async (path: string) => {
        expect(path).toContain("productos-frecuentes");
        return html;
      },
    };
    const products = await adapter.getFrequentPurchases(session);
    expect(products).toHaveLength(1);
    expect(products[0].id).toBe("1");
  });

  it("sin material de sesión explica cómo habilitarlo en vez de fallar en seco", async () => {
    await expect(adapter.getFrequentPurchases({ store: "jumbo" })).rejects.toThrow(
      /puente de navegador|frequentCards/
    );
  });
});
