import { describe, expect, it } from "vitest";
import { LiderAdapter } from "../../src/adapters/lider.js";
import { TottusAdapter } from "../../src/adapters/tottus.js";
import { UnimarcAdapter } from "../../src/adapters/unimarc.js";
import { HttpStatusError } from "../../src/http/client.js";
import { ProductSchema } from "../../src/core/types.js";

/**
 * Smoke live de Unimarc, Tottus y Lider, opt-in con LIVE=1. Unimarc responde
 * incluso desde GitHub Actions. Tottus y Lider bloquean el fetch directo por
 * huella del cliente, también desde IP residencial (verificado 2026-10-16), así
 * que con fetch plano su bloqueo es lo esperable en cualquier red.
 *
 * Bloqueo antibot vs. cambio de formato: desde la nube (GitHub Actions) el
 * bloqueo es ESPERABLE y no significa que el adaptador esté roto, así que por
 * defecto no hace fallar el smoke (solo emite un warning). Un cambio de
 * formato real se manifiesta distinto —el fetch pasa pero el esquema o la
 * aserción de resultados falla— y ese sí rompe el smoke.
 *
 * SMOKE_STRICT=1 vuelve el bloqueo un fallo: hoy fallan Tottus y Lider en
 * cualquier red, así que sirve para detectar si alguna dejó de bloquear.
 */
const live = process.env.LIVE === "1" ? describe : describe.skip;
const strict = process.env.SMOKE_STRICT === "1";

/**
 * Un bloqueo antibot llega como HttpStatusError (401/403/307/429) o como un
 * Error cuyo mensaje describe el antibot. Un cambio de formato NO: el fetch
 * devuelve 200 y falla después (ProductSchema.parse o la aserción de largo).
 */
function isExpectedAntibotBlock(err: unknown): boolean {
  if (err instanceof HttpStatusError) {
    return [401, 403, 307, 429].includes(err.status);
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /bloque|blocked|robot|perimeterx|antibot|big-?ip/i.test(msg);
}

/**
 * Corre el cuerpo del test; si falla por un bloqueo antibot esperable y no
 * estamos en modo estricto, lo tolera con un warning en vez de romper el
 * smoke. Cualquier otro error (esquema, aserción, red) se propaga.
 */
async function tolerateBlock(store: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (err) {
    if (!strict && isExpectedAntibotBlock(err)) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[smoke] ${store}: bloqueo antibot esperable desde datacenter, se tolera (SMOKE_STRICT=1 para exigirlo): ${msg}`
      );
      return;
    }
    throw err;
  }
}

live("Unimarc en vivo", () => {
  it("search_products devuelve productos válidos", async () => {
    await tolerateBlock("Unimarc", async () => {
      const products = await new UnimarcAdapter().searchProducts("leche", { limit: 5 });
      expect(products.length).toBeGreaterThan(0);
      for (const p of products) {
        ProductSchema.parse(p);
        expect(p.store).toBe("unimarc");
      }
    });
  }, 30000);
});

live("Tottus en vivo", () => {
  it("search_products devuelve productos válidos", async () => {
    await tolerateBlock("Tottus", async () => {
      const products = await new TottusAdapter().searchProducts("arroz", { limit: 5 });
      expect(products.length).toBeGreaterThan(0);
      for (const p of products) {
        ProductSchema.parse(p);
        expect(p.store).toBe("tottus");
      }
    });
  }, 30000);
});

live("Lider en vivo", () => {
  it("search_products devuelve productos válidos", async () => {
    await tolerateBlock("Lider", async () => {
      const products = await new LiderAdapter().searchProducts("arroz", { limit: 5 });
      expect(products.length).toBeGreaterThan(0);
      for (const p of products) {
        ProductSchema.parse(p);
        expect(p.store).toBe("lider");
      }
    });
  }, 30000);
});
