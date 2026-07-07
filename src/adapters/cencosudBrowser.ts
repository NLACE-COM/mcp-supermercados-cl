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
 * Headers de sesión que el frontend de Jumbo envía al BFF. El token sale del
 * `localStorage` (`sessionDataToken`); el resto son constantes del banner.
 * `apiKey` es pública (va en el JS del sitio). Verificado 2026-07-07.
 */
const JUMBO_SESSION_HEADERS_JS = `{
    "Authorization": "Bearer " + localStorage.getItem("sessionDataToken"),
    "token": localStorage.getItem("sessionDataToken"),
    "apiKey": "WnOIGTaOkfFwotM8Ddw2",
    "x-consumer": "jumbocl",
    "x-e-commerce": "jumbo",
    "x-account": "jumbocl",
    "x-client-platform": "web",
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
