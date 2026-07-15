import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlaywrightBridge } from "../../src/adapters/playwrightBridge.js";

/**
 * Playwright es opcional y NO está en las dependencias del paquete. Si el
 * usuario no lo instaló, el puente debe fallar con un mensaje que explique
 * cómo habilitarlo (y no con un ReferenceError críptico).
 *
 * La ausencia se SIMULA con `vi.mock`; antes se daba por hecho que el módulo
 * no estaba en `node_modules`, lo que hacía estos tests dependientes del
 * entorno y con dos consecuencias feas cuando alguien seguía el README e
 * instalaba Playwright para usar el puente:
 *  - `npm test` fallaba (el import resolvía y no salía el error guía);
 *  - peor, estos "tests de contrato" lanzaban un navegador real y navegaban a
 *    super.lider.cl, rompiendo la promesa de que no tocan la red.
 */
vi.mock("playwright", () => {
  throw new Error("Cannot find module 'playwright'");
});

describe("PlaywrightBridge sin Playwright instalado", () => {
  // El fallback por ruta explícita no debe interferir: si la variable está
  // definida en el entorno del dev, `loadPlaywright` la usaría y no llegaría
  // al error guía que se está verificando.
  const previo = process.env.SUPERMERCADOS_PLAYWRIGHT_PATH;
  beforeEach(() => {
    delete process.env.SUPERMERCADOS_PLAYWRIGHT_PATH;
  });
  afterEach(() => {
    if (previo !== undefined) process.env.SUPERMERCADOS_PLAYWRIGHT_PATH = previo;
  });

  it("lanza un error guía al intentar evaluar", async () => {
    const bridge = new PlaywrightBridge({ userDataDir: "/tmp/perfil-inexistente" });
    await expect(bridge.evaluate("/", "1 + 1")).rejects.toThrow(
      /Playwright no está disponible/
    );
  });

  it("fetchSsrHtml también guía a instalar Playwright", async () => {
    const bridge = new PlaywrightBridge({ userDataDir: "/tmp/perfil-inexistente" });
    await expect(
      bridge.fetchSsrHtml("https://super.lider.cl/search?query=arroz")
    ).rejects.toThrow(/Playwright no está disponible/);
  });
});
