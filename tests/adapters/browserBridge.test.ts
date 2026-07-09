import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  bridgeSession,
  getConfiguredBrowserBridge,
  setBrowserBridgeForTests,
  storeSupportsBrowserBridge,
  type SsrBrowserBridge,
} from "../../src/adapters/browserBridge.js";
import { compareStores } from "../../src/core/compare.js";
import { wrapLiderHtml } from "../../src/adapters/lider.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const liderFixture = JSON.parse(
  readFileSync(join(fixturesDir, "lider-search-arroz.json"), "utf-8")
);
const liderNextData = JSON.stringify({ x: { items: liderFixture.products } });

/** Puente falso: registra las URLs pedidas y responde con la fixture envuelta. */
function fakeBridge(): SsrBrowserBridge & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    async fetchSsrHtml(url: string) {
      urls.push(url);
      return wrapLiderHtml(liderNextData);
    },
  };
}

afterEach(() => {
  // Aísla el singleton perezoso entre casos (vitest aísla módulos por archivo,
  // pero dentro del archivo el estado persiste).
  setBrowserBridgeForTests(null);
});

describe("storeSupportsBrowserBridge", () => {
  it("marca las cadenas SSR con antibot y descarta el resto", () => {
    expect(storeSupportsBrowserBridge("lider")).toBe(true);
    expect(storeSupportsBrowserBridge("tottus")).toBe(true);
    expect(storeSupportsBrowserBridge("jumbo")).toBe(false);
    expect(storeSupportsBrowserBridge("santaisabel")).toBe(false);
  });
});

describe("bridgeSession", () => {
  it("antepone el host de la cadena al path del adaptador", async () => {
    const bridge = fakeBridge();
    const session = bridgeSession("lider", bridge, "branch-x")!;
    expect(session.store).toBe("lider");
    expect(session.branchId).toBe("branch-x");
    await session.fetchAuthedHtml!("/search?query=arroz");
    expect(bridge.urls).toEqual(["https://super.lider.cl/search?query=arroz"]);
  });

  it("no reescribe una URL que ya es absoluta", async () => {
    const bridge = fakeBridge();
    const session = bridgeSession("tottus", bridge)!;
    await session.fetchAuthedHtml!("https://www.tottus.cl/otra");
    expect(bridge.urls).toEqual(["https://www.tottus.cl/otra"]);
  });

  it("devuelve undefined para una cadena sin puente", () => {
    expect(bridgeSession("jumbo", fakeBridge())).toBeUndefined();
  });
});

describe("getConfiguredBrowserBridge", () => {
  it("sin configurar devuelve undefined (flujo manual)", () => {
    setBrowserBridgeForTests(null);
    expect(getConfiguredBrowserBridge()).toBeUndefined();
  });

  it("devuelve el puente inyectado para tests", () => {
    const bridge = fakeBridge();
    setBrowserBridgeForTests(bridge);
    expect(getConfiguredBrowserBridge()).toBe(bridge);
  });
});

describe("compareStores con puente de navegador", () => {
  it("resuelve una cadena SSR (Líder) vía el puente, sin tocar la red", async () => {
    const bridge = fakeBridge();
    const result = await compareStores(
      ["arroz"],
      ["lider"],
      undefined,
      undefined,
      bridge
    );
    const lider = result.stores.find((s) => s.store === "lider")!;
    expect(lider.error).toBeUndefined();
    expect(lider.matched).toBeGreaterThan(0);
    // Navegó a la URL de búsqueda de Líder con el puente.
    expect(bridge.urls[0]).toContain("https://super.lider.cl/search?query=arroz");
  });
});
