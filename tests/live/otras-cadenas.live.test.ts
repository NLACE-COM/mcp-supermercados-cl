import { describe, expect, it } from "vitest";
import { LiderAdapter } from "../../src/adapters/lider.js";
import { TottusAdapter } from "../../src/adapters/tottus.js";
import { UnimarcAdapter } from "../../src/adapters/unimarc.js";
import { HttpStatusError } from "../../src/http/client.js";
import { ProductSchema } from "../../src/core/types.js";

/**
 * Smoke live de Unimarc, Tottus y Lider. Requieren IP RESIDENCIAL (la
 * máquina del usuario). Desde datacenter estas cadenas bloquean (403/antibots),
 * por eso son opt-in con LIVE=1 y no corren en CI.
 *
 * Bloqueo antibot vs. cambio de formato: desde la nube (GitHub Actions) el
 * bloqueo es ESPERABLE y no significa que el adaptador esté roto, así que por
 * defecto no hace fallar el smoke (solo emite un warning). Un cambio de
 * formato real se manifiesta distinto —el fetch pasa pero el esquema o la
 * aserción de resultados falla— y ese sí rompe el smoke.
 *
 * En un runner con IP residencial, corre con SMOKE_STRICT=1 para que el
 * bloqueo vuelva a ser fallo y así tener cobertura real de las tres cadenas.
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
