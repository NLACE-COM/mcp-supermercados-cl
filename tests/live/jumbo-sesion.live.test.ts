import { homedir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlaywrightBridge } from "../../src/adapters/playwrightBridge.js";
import {
  jumboDiscoverBranchSnippet,
  jumboFetchSnippet,
  jumboFrequentCardsSnippet,
} from "../../src/adapters/cencosudBrowser.js";
import { parseCart } from "../../src/adapters/cencosudCart.js";
import { parseShoppingLists } from "../../src/adapters/cencosudLists.js";
import { parseFrequentCard } from "../../src/adapters/cencosudSession.js";
import type { FrequentCard } from "../../src/core/types.js";

/**
 * Smoke de las tools de SESIÓN de Jumbo (carro, listas guardadas, frecuentes).
 *
 * Por qué existe (issue #12): estas tools no las cubre nada más. Los tests de
 * contrato usan fixtures (no tocan la red), y el smoke live semanal solo cubre
 * `search_products`. El agujero es real: en la 1.4.4 Jumbo rotó las `apiKey` de
 * su BFF y el carro Y las listas quedaron rotos dos días sin que nadie lo
 * viera; lo reportó un usuario (#11).
 *
 * Por qué NO corre en CI: necesita el token de sesión, que vive solo en el
 * `localStorage` de un navegador logueado. No hay forma de ejercitarlo desde un
 * runner. Por eso es manual y bajo demanda:
 *
 *     npm run session:login   # una sola vez: inicias sesión en el perfil
 *     npm run test:session    # cada vez que quieras verificar
 *
 * Correrlo antes de publicar una versión convierte un bug silencioso de días
 * en un fallo visible en 30 segundos.
 *
 * Usa un perfil de Chrome DEDICADO (`~/.supermercados-smoke-profile`), no el
 * del usuario. Verificado por qué importa: `launchPersistentContext` toma el
 * lock exclusivo del perfil, así que el perfil diario obligaría a cerrar Chrome
 * en cada corrida y, siendo grande (7,8 GB en la máquina donde se probó), el
 * lanzamiento ni siquiera completa —muere por timeout sin conectar—. Con perfil
 * dedicado arranca en ~2 s y el navegador del usuario sigue abierto.
 *
 * Qué valida: que el sitio real **acepta** los requests que arman los snippets
 * de producción (`jumboFetchSnippet` y compañía) y que los parsers de
 * producción entienden lo que responde. Por eso importa usar los snippets
 * reales y no headers copiados aquí: un test con headers propios pasaría
 * mientras producción está rota, que es exactamente el bug que dejamos pasar.
 */
const profile =
  process.env.SUPERMERCADOS_SMOKE_PROFILE?.trim() ||
  join(homedir(), ".supermercados-smoke-profile");
const live = process.env.LIVE_SESSION === "1" ? describe : describe.skip;

/**
 * Los errores del BFF llegan con 200-looking shape `{ message: "..." }` porque
 * el snippet hace `r.json()` sin mirar el status. Traducirlos acá es lo que
 * convierte un críptico "no se pudo parsear" en la causa real:
 *  - 401 "Invalid authentication credentials" → la apiKey venció.
 *  - 403 "You cannot consume this service"    → apiKey de OTRO servicio.
 */
function assertBffAccepted(raw: unknown, servicio: string): void {
  const message = (raw as { message?: unknown } | null)?.message;
  if (typeof message !== "string") return;
  throw new Error(
    `El BFF rechazó el request de ${servicio}: "${message}".\n` +
      `Causa típica: Jumbo rotó las apiKey del BFF (pasó en la 1.4.4).\n` +
      `Arreglo: recupera el mapa { bff_cart, bff_lists, ... } del bundle público ` +
      `(assets-jumbo.ecomm.cencosud.com, chunk de config) y actualiza ` +
      `JUMBO_API_KEYS en src/adapters/cencosudBrowser.ts. ` +
      `Ojo: cada servicio valida SOLO su key ("You cannot consume this service" ` +
      `= le mandaste la de otro servicio).`
  );
}

live("Jumbo con sesión (carro, listas, frecuentes)", () => {
  let bridge: PlaywrightBridge;
  let branchId: string;

  beforeAll(async () => {
    bridge = new PlaywrightBridge({
      userDataDir: profile,
      channel: (process.env.SUPERMERCADOS_PLAYWRIGHT_CHANNEL as "chrome") ?? "chrome",
      headless: false,
    });

    // Sin sesión no tiene sentido seguir: los tres tests fallarían con errores
    // del BFF que parecerían un cambio de contrato. Se comprueba la EXISTENCIA
    // del token, nunca su valor.
    const loggedIn = await bridge.evaluate<boolean>(
      "/",
      `!!localStorage.getItem("sessionDataToken")`
    );
    if (!loggedIn) {
      throw new Error(
        `El perfil del smoke (${profile}) no tiene sesión en jumbo.cl.\n` +
          `Corre primero:  npm run session:login`
      );
    }

    // La sucursal sale del navegador (misma vía que la tool discover_branch),
    // así el smoke no hardcodea una tienda que puede no existir mañana.
    const branch = await bridge.evaluate<{ found: boolean; branchId?: string }>(
      "/",
      jumboDiscoverBranchSnippet()
    );
    if (!branch.found || !branch.branchId) {
      throw new Error(
        "No se pudo descubrir la sucursal desde el navegador. Elige tu comuna " +
          "o tienda en jumbo.cl con el perfil del smoke (npm run session:login) " +
          "y reintenta."
      );
    }
    branchId = branch.branchId;
  }, 90_000);

  afterAll(async () => {
    await bridge?.close();
  });

  it("get_cart: el BFF acepta el request y el parser entiende el carro", async () => {
    const path = `/cart?store=${branchId}&simulationTotals=true`;
    const raw = await bridge.evaluate<unknown>("/", jumboFetchSnippet(path, "cart"));

    assertBffAccepted(raw, "el carro (GET /cart)");

    // parseCart es el de producción: si cambia la forma del JSON, revienta acá.
    const cart = parseCart(raw, "jumbo");
    expect(Array.isArray(cart.items)).toBe(true);
    expect(typeof cart.total).toBe("number");
  }, 60_000);

  it("get_saved_lists: el BFF acepta el request y el parser entiende las listas", async () => {
    const path = `/lists?store=${branchId}`;
    const raw = await bridge.evaluate<unknown>("/", jumboFetchSnippet(path, "lists"));

    assertBffAccepted(raw, "las listas guardadas (GET /lists)");

    // La forma esperada trae `lists`; un carro/otra cosa no la tendría.
    expect(raw).toHaveProperty("lists");
    // No se asume que el usuario TENGA listas: 0 listas es válido y no es un
    // fallo de contrato. Lo que se valida es que el parser no reviente.
    const lists = parseShoppingLists(raw, "jumbo");
    expect(Array.isArray(lists)).toBe(true);
  }, 60_000);

  it("get_frequent_purchases: las cards del DOM siguen siendo parseables", async () => {
    // /productos-frecuentes es un shell client-side: el bridge navega con
    // `domcontentloaded`, así que sin esperar a que React pinte las cards el
    // snippet lee un DOM vacío y devuelve 0 SIEMPRE — un verde falso que no
    // valida nada (el mismo error de timing que rompió el puente en la 1.4.1).
    // La espera va acá, envolviendo el snippet, para no tocar el de producción.
    // Los paréntesis alrededor del snippet NO son decorativos: empieza con un
    // comentario `//`, así que `return <snippet>` quedaría como `return` +
    // comentario + salto de línea → ASI inserta el `;` y devuelve undefined,
    // con el array como código muerto. (Por eso `evaluate` también lo envuelve.)
    const conEspera = `(async () => {
      const limite = Date.now() + 20000;
      while (Date.now() < limite && !document.querySelector("[data-cnstrc-item-id]")) {
        await new Promise((r) => setTimeout(r, 300));
      }
      return (${jumboFrequentCardsSnippet()});
    })()`;

    const cards = await bridge.evaluate<FrequentCard[]>(
      "/productos-frecuentes",
      conEspera
    );
    expect(Array.isArray(cards)).toBe(true);

    // 0 cards = o el usuario no tiene frecuentes, o los selectores del DOM
    // cambiaron. No se puede distinguir, así que se avisa en vez de fallar.
    if (cards.length === 0) {
      console.warn(
        "[smoke sesión] /productos-frecuentes devolvió 0 cards. Puede ser que " +
          "esta cuenta no tenga frecuentes, o que cambiaron los selectores " +
          "(data-cnstrc-item-id) que espera jumboFrequentCardsSnippet."
      );
      return;
    }

    // Si hay cards, el parser tiene que sacar productos válidos de ellas: eso
    // es lo que se rompe cuando el DOM cambia.
    const productos = cards
      .map((c) => parseFrequentCard(c, "jumbo", "https://www.jumbo.cl"))
      .filter((p) => p !== null);
    expect(productos.length).toBeGreaterThan(0);
    for (const p of productos) {
      expect(p!.price).toBeGreaterThan(0);
      expect(p!.name.length).toBeGreaterThan(0);
    }
  }, 60_000);
});
