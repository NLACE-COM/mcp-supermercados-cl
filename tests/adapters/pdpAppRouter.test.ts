import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CencosudAdapter, JUMBO_CONFIG } from "../../src/adapters/cencosud.js";
import {
  extractRscPayload,
  findProductInRscPayload,
  sliceBalancedJson,
} from "../../src/adapters/rscPayload.js";
import { ProductSchema } from "../../src/core/types.js";

const ARROZ_SLUG = "arroz-grado-1-banquete-1-kg-premium-grano-largo-y-ancho";
const ACEITE_SLUG = "aceite-maravilla-chef-1-l";

const pdpHtml = readFileSync(
  fileURLToPath(
    new URL("../fixtures/jumbo-pdp-app-router-2026-08-01.html", import.meta.url)
  ),
  "utf-8"
);

describe("rscPayload · lectura del stream de App Router", () => {
  it("reconstruye el payload desde los self.__next_f.push", () => {
    const payload = extractRscPayload(pdpHtml);
    expect(payload.length).toBeGreaterThan(0);
    // Ya desescapado: comillas reales, no \" literales.
    expect(payload).toContain(`"slug":"${ARROZ_SLUG}"`);
    expect(payload).not.toContain('\\"slug\\"');
  });

  it("devuelve vacío si la página no es App Router", () => {
    expect(extractRscPayload("<html><body>sin RSC</body></html>")).toBe("");
  });

  it("recorta objetos balanceados respetando llaves dentro de strings", () => {
    const text = 'x={"a":"}{","b":{"c":1}} sobra';
    const raw = sliceBalancedJson(text, 2);
    expect(raw).toBe('{"a":"}{","b":{"c":1}}');
    expect(JSON.parse(raw!)).toEqual({ a: "}{", b: { c: 1 } });
  });

  it("elige el producto por slug y no el primero del payload", () => {
    const payload = extractRscPayload(pdpHtml);

    // El arroz es el producto principal; el aceite viene en un carrusel.
    const arroz = findProductInRscPayload(payload, ARROZ_SLUG) as { slug: string };
    const aceite = findProductInRscPayload(payload, ACEITE_SLUG) as { slug: string };

    expect(arroz.slug).toBe(ARROZ_SLUG);
    expect(aceite.slug).toBe(ACEITE_SLUG);
  });

  it("devuelve null si el slug no está en el payload", () => {
    const payload = extractRscPayload(pdpHtml);
    expect(findProductInRscPayload(payload, "producto-que-no-existe")).toBeNull();
  });
});

describe("CencosudAdapter · PDP de App Router (regresión 2026-08)", () => {
  const adapter = new CencosudAdapter(JUMBO_CONFIG);

  it("parsea el producto principal con esquema válido", () => {
    const product = adapter.parsePdpHtml(
      pdpHtml,
      `https://www.jumbo.cl/${ARROZ_SLUG}/p`
    );

    expect(product).not.toBeNull();
    ProductSchema.parse(product);
    expect(product!.id).toBe("1570");
    expect(product!.name).toContain("Arroz");
    expect(product!.brand).toBe("Banquete");
    expect(product!.price).toBe(2530);
    expect(product!.unit).toBe("kg");
  });

  it("extrae el precio socio de las promos PRIME_USER", () => {
    // El aceite traía promo Prime al 20% ese día: $3.630 público, $2.904 socio.
    const product = adapter.parsePdpHtml(
      pdpHtml,
      `https://www.jumbo.cl/${ACEITE_SLUG}/p`
    );

    expect(product).not.toBeNull();
    ProductSchema.parse(product);
    expect(product!.price).toBe(3630);
    expect(product!.memberPrice).toBe(2904);
  });

  it("no confunde un producto con otro de la misma página", () => {
    const arroz = adapter.parsePdpHtml(pdpHtml, `https://www.jumbo.cl/${ARROZ_SLUG}/p`);
    const aceite = adapter.parsePdpHtml(
      pdpHtml,
      `https://www.jumbo.cl/${ACEITE_SLUG}/p`
    );

    expect(arroz!.id).not.toBe(aceite!.id);
    expect(aceite!.brand).toBe("Chef");
  });

  it("devuelve null si el HTML no trae producto parseable", () => {
    expect(
      adapter.parsePdpHtml(
        "<html><body>vacío</body></html>",
        "https://www.jumbo.cl/x/p"
      )
    ).toBeNull();
  });
});
