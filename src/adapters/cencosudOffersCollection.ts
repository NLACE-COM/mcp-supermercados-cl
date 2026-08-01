/**
 * Resolución dinámica de la colección de ofertas de Jumbo.
 *
 * Contexto (verificado 2026-08-01, issue #18): los `collection_id` de
 * Constructor que alimentan /jumbo-ofertas NO son fijos. Son colecciones de
 * CAMPAÑA con fecha de término (`data.dateTo`), así que expiran y son
 * reemplazadas cada una o dos semanas; el id viejo pasa a responder HTTP 404.
 * Hardcodear el id obliga a parchear el repo cada vez (ya pasó con 30399 →
 * 30509 → 404), por eso aquí se descubre el id vigente en runtime.
 *
 * Además, en un momento dado hay VARIAS colecciones de ofertas activas a la
 * vez (una por ciclo). Ejemplo real del 2026-08-01:
 *
 *   30930  Collection-Todaslasofertaslpmciclo2ladespensa       8.714  hasta 18-08
 *   30774  Collection-Todaslasofertaslpmciclo1ladespensa       5.632  hasta 15-08
 *   30632  Collection-Todaslasofertasdelciclo5LPM              5.426  hasta 02-08
 *   30762  Collection-TodaslasofertasdelaLPMAgostoaniversario  4.113  hasta 28-08
 *
 * Se elige la de mayor catálogo entre las vigentes: es la que mejor representa
 * "las ofertas de Jumbo" para get_offers.
 *
 * OJO: el método que documentaba docs/captura-cencosud-2026-07-06.md §3b
 * (leer `originalUrl":"/busca?fq=H%3A<id>"` del SSR) YA NO SIRVE: /jumbo-ofertas
 * dejó de ser un browse de una colección única y hoy es un landing de
 * carruseles de campaña, sin ese campo. Los ids se recuperan de otras dos
 * huellas que sí siguen en el SSR (ver extractCollectionIdCandidates).
 */

/** Datos de una colección tal como los devuelve el browse de Constructor. */
export interface CollectionProbe {
  id: string;
  displayName: string;
  /** Cantidad de productos de la colección (`total_num_results`). */
  total: number;
  /** `data.active` de la colección; false la descarta. */
  active: boolean;
  /** `data.dateTo` parseado a epoch ms; undefined si no viene o no parsea. */
  expiresAt?: number;
}

/**
 * Ids de colección candidatos presentes en el SSR de /jumbo-ofertas, de más
 * a menos probable. Dos huellas verificadas:
 *
 * 1. `"collections":["30930","28992",...]` — cada producto del SSR declara a
 *    qué colecciones pertenece. La colección de ofertas aparece en muchos de
 *    ellos, así que ordenar por frecuencia la deja arriba.
 * 2. `href="/busca?fq=H%3A30765"` — los banners de campaña enlazan a
 *    colecciones por id.
 *
 * El HTML de Next trae estos fragmentos escapados dentro de strings JS
 * (`\"collections\":[\"30930\"]`), de ahí las comillas opcionales en la regex.
 */
export function extractCollectionIdCandidates(html: string): string[] {
  const frequency = new Map<string, number>();
  const bump = (id: string, weight = 1) => {
    frequency.set(id, (frequency.get(id) ?? 0) + weight);
  };

  // 1. Listas `collections` de cada producto: se cuenta una vez por producto.
  const listPattern = /\\?"collections\\?"\s*:\s*\[([^\]]*)\]/g;
  for (const match of html.matchAll(listPattern)) {
    const ids = new Set(match[1].match(/\d+/g) ?? []);
    for (const id of ids) bump(id);
  }

  // 2. Enlaces de banner `fq=H%3A<id>` (también en su forma sin escapar `H:`).
  for (const match of html.matchAll(/fq=H(?:%3A|:)(\d+)/gi)) {
    bump(match[1], 0.5);
  }

  return [...frequency.entries()]
    .sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))
    .map(([id]) => id);
}

/**
 * ¿El nombre de la colección corresponde al listado general de ofertas?
 *
 * Jumbo nombra estas colecciones sin espacios y de forma inconsistente
 * ("Collection-Todaslasofertaslpmciclo2ladespensa",
 * "Collection-TodaslasofertasdelaLPMAgostoaniversario"), así que se normaliza
 * a minúsculas sin separadores y se busca el prefijo común "todaslasofertas".
 * Deliberadamente NO matchea colecciones de una marca o categoría puntual
 * (ej. "Collection-OfertasPepsi"), que no representan el catálogo de ofertas.
 */
export function isOffersCollectionName(displayName: string): boolean {
  const normalized = displayName.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized.includes("todaslasofertas");
}

/**
 * Convierte el `data.dateTo` de Constructor a epoch ms.
 * Viene como string CON comillas literales dentro (`"\"2026-08-18T23:59:00.000Z\""`).
 */
export function parseCollectionDateTo(raw: unknown): number | undefined {
  if (typeof raw !== "string") return undefined;
  const cleaned = raw.replace(/^"+|"+$/g, "").trim();
  if (!cleaned || cleaned === "null") return undefined;
  const parsed = Date.parse(cleaned);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Elige la colección de ofertas vigente con más productos.
 * Descarta las inactivas y las ya vencidas según `now`.
 */
export function pickBestOffersCollection(
  probes: CollectionProbe[],
  now: number = Date.now()
): CollectionProbe | undefined {
  return probes
    .filter((c) => c.active && isOffersCollectionName(c.displayName))
    .filter((c) => c.expiresAt === undefined || c.expiresAt > now)
    .sort((a, b) => b.total - a.total)[0];
}
