/**
 * Login inicial del perfil del smoke de sesión (`npm run session:login`).
 *
 * Abre una ventana de Chrome con un perfil DEDICADO —no el tuyo— para que
 * inicies sesión en jumbo.cl una sola vez. La sesión queda persistida ahí y
 * `npm run test:session` la reusa en cada corrida.
 *
 * Por qué un perfil aparte y no el tuyo: `launchPersistentContext` toma el lock
 * exclusivo del perfil, así que usar el de tu Chrome diario obliga a cerrarlo
 * en cada corrida, y sobre un perfil grande (varios GB) el lanzamiento ni
 * siquiera completa. Con un perfil dedicado el smoke arranca en segundos y tu
 * navegador no se entera. Ver issue #12.
 *
 * Este script NUNCA ve tus credenciales: las escribes tú en la ventana de
 * Chrome. Aquí solo se espera a que el token aparezca en el localStorage del
 * sitio, y se comprueba su existencia, nunca su valor.
 */
import { homedir } from "node:os";
import { join } from "node:path";

const PROFILE =
  process.env.SUPERMERCADOS_SMOKE_PROFILE?.trim() ||
  join(homedir(), ".supermercados-smoke-profile");
const CHANNEL = process.env.SUPERMERCADOS_PLAYWRIGHT_CHANNEL?.trim() || "chrome";
const TIMEOUT_MS = 10 * 60_000;

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "Falta Playwright. Instálalo con:\n\n" +
      "  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-save playwright\n\n" +
      "(se salta la descarga de navegadores porque usamos el Chrome que ya tienes)."
  );
  process.exit(1);
}

console.log(`Perfil del smoke: ${PROFILE}`);
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  channel: CHANNEL,
  timeout: 60_000,
});

const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto("https://www.jumbo.cl/login", { waitUntil: "domcontentloaded" });

console.log("\n┌──────────────────────────────────────────────────────────────┐");
console.log("│  1. Inicia sesión en la ventana de Chrome que se abrió.       │");
console.log("│  2. Elige tu comuna o tienda (el smoke necesita la sucursal). │");
console.log("│  3. Esta ventana se cierra sola al detectar la sesión.        │");
console.log("└──────────────────────────────────────────────────────────────┘\n");
console.log("Esperando... (Ctrl+C para cancelar)");

const deadline = Date.now() + TIMEOUT_MS;
let ok = false;
while (Date.now() < deadline) {
  try {
    const state = await page.evaluate(`(() => {
      const dm = localStorage.getItem("delivery-method-state");
      const branch = (String(dm || "").match(/[a-z]{2,}cl[a-z]?\\d{2,}/i) || [])[0] || null;
      return { token: !!localStorage.getItem("sessionDataToken"), branch };
    })()`);
    if (state.token && state.branch) {
      console.log(`\n✅ Sesión detectada. Sucursal: ${state.branch}`);
      console.log("   Ya puedes correr: npm run test:session");
      ok = true;
      break;
    }
    if (state.token && !state.branch) {
      process.stdout.write("\r   Sesión OK, falta elegir comuna/tienda...      ");
    }
  } catch {
    // Navegación en curso (el evaluate corre contra un documento que se está
    // reemplazando): reintentar en el próximo ciclo.
  }
  await new Promise((r) => setTimeout(r, 2000));
}

if (!ok) console.error("\n⏱️  Se agotó la espera sin detectar la sesión.");
await ctx.close();
process.exit(ok ? 0 : 1);
