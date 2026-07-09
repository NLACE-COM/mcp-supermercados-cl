/**
 * Extracción del `<script id="__NEXT_DATA__">` del HTML SSR de Next.js,
 * compartida por los adaptadores Líder y Tottus.
 *
 * Robusto al **orden de atributos** y a un **nonce de CSP**: al traer el HTML
 * por el puente de navegador (Chrome real), el `<script>` llega como
 * `<script nonce="" id="__NEXT_DATA__" type="application/json">` — con el nonce
 * ANTES del id. Un marcador literal `<script id="__NEXT_DATA__"...` no lo
 * matcheaba y hacía creer que la página estaba bloqueada (el fetch HTTP plano
 * de las fixtures no lleva nonce, por eso el bug no salía en los tests).
 */
const NEXT_DATA_OPEN = /<script[^>]*\bid="__NEXT_DATA__"[^>]*>/i;

/** JSON crudo del `__NEXT_DATA__`, o null si no está en el HTML. */
export function extractNextDataJson(html: string): string | null {
  const m = NEXT_DATA_OPEN.exec(html);
  if (!m) return null;
  const from = m.index + m[0].length;
  const end = html.indexOf("</script>", from);
  if (end === -1) return null;
  return html.slice(from, end);
}

/** true si el HTML contiene el `<script id="__NEXT_DATA__">`. */
export function hasNextData(html: string): boolean {
  return NEXT_DATA_OPEN.test(html);
}
