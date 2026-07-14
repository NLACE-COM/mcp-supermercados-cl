/**
 * Snippets de navegador para las tools de sesión de Cencosud (Jumbo/Santa
 * Isabel). El servidor MCP nunca ve credenciales: el cliente ejecuta estos
 * snippets **en el contexto de una pestaña ya logueada** del sitio y entrega
 * el JSON resultante a la tool para que lo normalice.
 *
 * Por qué un snippet y no "extrae el DOM": el token de sesión vive en el
 * `localStorage` del sitio y el BFF responde el carro/listas/frecuentes en
 * **una sola** llamada JSON. Raspar el estado de React o el DOM a mano es
 * lento, frágil y equivale a rehacer a mano lo que este fetch trae directo.
 *
 * CORS: el fetch DEBE correr en el mismo origen del sitio (una pestaña de
 * www.jumbo.cl / www.santaisabel.cl), donde el navegador ya tiene los
 * permisos. Desde una pestaña en blanco, el preflight lo bloquea.
 */

/** Host del BFF de Jumbo (carro, listas, frecuentes). */
export const JUMBO_BFF_BASE = "https://be-reg-groceries-bff-jumbo.ecomm.cencosud.com";

/**
 * Headers que hoy usa el frontend de Jumbo para el carro. El token sale del
 * `localStorage` (`sessionDataToken`) y la `apiKey` es pública (va en el JS del
 * sitio). No incluir `token`, `x-consumer`, `x-e-commerce` ni `x-account`:
 * Jumbo los rechaza en el preflight. `x-client-platform`, `x-client-version` y
 * `x-trace-id`, en cambio, están permitidos y forman parte del contrato actual
 * del BFF de carro.
 */
const JUMBO_SESSION_HEADERS_JS = `{
    "Authorization": "Bearer " + localStorage.getItem("sessionDataToken"),
    "apiKey": "be-reg-groceries-jumbo-cart-rhk68rqi0adn",
    "x-client-platform": "web",
    "x-client-version": "3.3.98",
    "x-trace-id": crypto.randomUUID(),
    "Accept": "application/json"
  }`;

/**
 * Genera un snippet JS listo para pegar en la consola (o ejecutar vía
 * automatización) de una pestaña logueada de www.jumbo.cl. Devuelve el JSON
 * que luego se pasa a la tool. `path` es la ruta del BFF (con querystring).
 */
export function jumboFetchSnippet(path: string): string {
  return (
    `// Ejecutar en una pestaña YA LOGUEADA de https://www.jumbo.cl (mismo origen).\n` +
    `await fetch(${JSON.stringify(JUMBO_BFF_BASE + path)}, {\n` +
    `  credentials: "include",\n` +
    `  headers: ${JUMBO_SESSION_HEADERS_JS}\n` +
    `}).then(r => r.json())`
  );
}

/**
 * Igual que `jumboFetchSnippet` pero para un request con cuerpo (POST/PATCH),
 * ej. PATCH /cart/items para agregar al carro.
 */
export function jumboMutateSnippet(
  path: string,
  method: "POST" | "PATCH",
  body: unknown
): string {
  return (
    `// Ejecutar en una pestaña YA LOGUEADA de https://www.jumbo.cl (mismo origen).\n` +
    `await fetch(${JSON.stringify(JUMBO_BFF_BASE + path)}, {\n` +
    `  credentials: "include",\n` +
    `  method: ${JSON.stringify(method)},\n` +
    `  body: JSON.stringify(${JSON.stringify(body)}),\n` +
    `  headers: {\n` +
    `    "Content-Type": "application/json",\n` +
    `    ...${JUMBO_SESSION_HEADERS_JS}\n` +
    `  }\n` +
    `}).then(r => r.json())`
  );
}

/**
 * Snippet para extraer las cards de /productos-frecuentes en UNA pasada. La
 * página es un shell client-side (no hay endpoint JSON limpio de frecuentes),
 * así que aquí sí se lee el DOM — pero de forma acotada y consistente con lo
 * que espera el parser (`data-cnstrc-item-*`, tachado, "Paga $X" = Prime).
 * Evita que el cliente improvise selectores o rasque el estado de React.
 */
export function jumboFrequentCardsSnippet(): string {
  return `// Ejecutar en https://www.jumbo.cl/productos-frecuentes YA LOGUEADO.
[...document.querySelectorAll("[data-cnstrc-item-id]")].map((el) => ({
  id: el.getAttribute("data-cnstrc-item-id"),
  name: el.getAttribute("data-cnstrc-item-name"),
  dataPrice: el.getAttribute("data-cnstrc-item-price"),
  href: el.querySelector("a")?.getAttribute("href") ?? null,
  tachado: el.querySelector(".line-through")?.textContent?.trim() ?? null,
  ppuNodes: [...el.querySelectorAll(".ppum-price-container")].map((n) => n.textContent.trim()),
  prime: ([...el.querySelectorAll("*")].find((n) => /Paga\\s*\\$/.test(n.textContent || ""))?.textContent || "").match(/Paga\\s*\\$[\\d.]+/)?.[0] ?? null,
  innerText: el.textContent.trim(),
}))`;
}

/**
 * Snippet para descubrir la sucursal (branchId, ej. "jumboclj512") desde el
 * navegador, sin que el usuario tenga que conocer el código. La sucursal vive
 * en `delivery-method-state` (localStorage) cuando el usuario ya eligió su
 * modo de entrega/comuna; como respaldo, se escanea el resto del storage y las
 * cookies por el patrón de branchId. Si no hay nada, devuelve found:false con
 * una pista (el usuario debe elegir su comuna/tienda en el sitio primero).
 */
export function jumboDiscoverBranchSnippet(): string {
  return `// Ejecutar en https://www.jumbo.cl ya con tu comuna/tienda elegida.
(() => {
  const PAT = /[a-z]{2,}cl[a-z]?\\d{2,}/gi;
  const found = new Set();
  const push = (v) => { for (const m of String(v||"").match(PAT) || []) found.add(m); };
  // 1) delivery-method-state: donde vive la sucursal elegida.
  try { push(localStorage.getItem("delivery-method-state")); } catch {}
  // 2) respaldo: cualquier valor con forma de branchId en storage/cookies.
  try { for (const k of Object.keys(localStorage)) push(localStorage.getItem(k)); } catch {}
  try { push(document.cookie); } catch {}
  const branches = [...found];
  return branches.length
    ? { found: true, branchId: branches[0], candidates: branches }
    : { found: false, hint: "Elige tu comuna o tienda en jumbo.cl (modo de entrega) y vuelve a intentar." };
})()`;
}

/**
 * Instrucción estándar para el cliente MCP: cómo obtener el JSON sin que el
 * servidor toque credenciales, y qué NO hacer (raspar React/DOM).
 */
export function browserFetchNote(what: string): string {
  return (
    `Para obtener ${what} sin exponer credenciales: ejecuta el snippet en ` +
    `browserSnippet dentro de una pestaña YA LOGUEADA del sitio (mismo origen, ` +
    `si no CORS lo bloquea), y pasa el JSON resultante a esta tool. ` +
    `Es UNA sola llamada — NO extraigas el estado de React ni el DOM a mano ` +
    `(es lento y frágil).`
  );
}
