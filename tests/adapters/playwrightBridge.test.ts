import { describe, expect, it } from "vitest";
import { PlaywrightBridge } from "../../src/adapters/playwrightBridge.js";

/**
 * Playwright es opcional y NO está en las dependencias del paquete. Si el
 * usuario no lo instaló, el puente debe fallar con un mensaje que explique
 * cómo habilitarlo (y no con un ReferenceError críptico).
 */
describe("PlaywrightBridge sin Playwright instalado", () => {
  it("lanza un error guía al intentar evaluar", async () => {
    const bridge = new PlaywrightBridge({ userDataDir: "/tmp/perfil-inexistente" });
    await expect(bridge.evaluate("/", "1 + 1")).rejects.toThrow(
      /Playwright no está instalado/
    );
  });
});
