import { describe, expect, it } from "vitest";
import { extractNextDataJson, hasNextData } from "../../src/adapters/nextData.js";

/**
 * El HTML traído por el puente de navegador (Chrome real) inyecta un `nonce`
 * de CSP antes del `id`, que un marcador literal no matcheaba. Estos tests
 * fijan el caso real que rompía Líder al usar el puente.
 */
describe("extractNextDataJson · robusto a nonce y orden de atributos", () => {
  const json = '{"props":{"pageProps":{"x":1}}}';

  it("extrae con el marcador simple (fetch HTTP plano)", () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${json}</script>`;
    expect(extractNextDataJson(html)).toBe(json);
    expect(hasNextData(html)).toBe(true);
  });

  it("extrae aunque el nonce vaya ANTES del id (Chrome real)", () => {
    const html = `<script nonce="" id="__NEXT_DATA__" type="application/json">${json}</script>`;
    expect(extractNextDataJson(html)).toBe(json);
    expect(hasNextData(html)).toBe(true);
  });

  it("extrae con nonce con valor y atributos en otro orden", () => {
    const html = `<html><body><script type="application/json" nonce="abc123" id="__NEXT_DATA__">${json}</script></body></html>`;
    expect(extractNextDataJson(html)).toBe(json);
  });

  it("devuelve null cuando no hay __NEXT_DATA__ (página de bloqueo)", () => {
    expect(
      extractNextDataJson("<html><title>Robot or human?</title></html>")
    ).toBeNull();
    expect(hasNextData("<html></html>")).toBe(false);
  });
});
