import { computeUnitPrice } from "../core/normalize.js";
import type { FrequentCard, Product, StoreId } from "../core/types.js";

/**
 * Parser de la sección autenticada de Jumbo (productos frecuentes / listas).
 *
 * A diferencia de la búsqueda (JSON de Constructor) y la PDP (estado React
 * Query), la grilla de productos frecuentes se renderiza client-side en el
 * DOM con atributos `data-cnstrc-item-*` y textos de precio. El puente de
 * navegador entrega esas cards; aquí se normalizan a Product.
 *
 * Casos reales cubiertos (captura 2026-07-07, sesión del usuario):
 * - Precio Prime: badge "Paga $1.288" => memberPrice.
 * - Precio vigente + tachado pegados en un nodo ("$1.472$1.840").
 * - Productos por peso (Salame granel: "$14.720 x kg").
 * - Exclusivo online con promos "Lleva 8 por $5.600" (no confundir con precio).
 */

/** "$1.288" | "$14.720" | "1.390" -> 1288 | 14720 | 1390 */
export function parseClp(text: string | null | undefined): number | undefined {
  if (!text) return undefined;
  const m = text.match(/\$?\s*([\d.]+)/);
  if (!m) return undefined;
  const n = Number(m[1].replace(/\./g, ""));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** "$14.720 x kg" -> { unitPrice: 14720, unit: "kg" } */
export function parsePpu(
  node: string | undefined
): { unitPrice: number; unit: string } | undefined {
  if (!node) return undefined;
  const m = node.match(/\$?\s*([\d.]+)\s*x\s*([a-zA-Z]+)/);
  if (!m) return undefined;
  const unitPrice = Number(m[1].replace(/\./g, ""));
  if (!Number.isFinite(unitPrice)) return undefined;
  return { unitPrice, unit: m[2].toLowerCase() };
}

/** Marca: en el DOM va como un segmento del innerText antes del nombre. */
function extractBrand(card: FrequentCard): string | undefined {
  if (!card.innerText) return undefined;
  const segments = card.innerText.split("|").map((s) => s.trim());
  const nameIdx = segments.findIndex((s) => s === card.name);
  if (nameIdx > 0) {
    const brand = segments[nameIdx - 1];
    // filtrar segmentos que claramente no son marca
    if (brand && !/\$|\bpor\b|dcto|online|oferta/i.test(brand)) return brand;
  }
  return undefined;
}

export function parseFrequentCard(
  card: FrequentCard,
  store: StoreId,
  siteBaseUrl: string
): Product | null {
  const price = parseClp(card.dataPrice);
  if (price === undefined || !card.name) return null;

  // listPrice: el nodo tachado, solo si es un descuento real.
  let listPrice = parseClp(card.tachado);
  if (listPrice !== undefined && listPrice <= price) listPrice = undefined;

  // memberPrice: badge "Paga $X" (precio Prime del socio).
  const memberPrice = parseClp(card.prime ?? undefined);

  // precio por unidad: el primer nodo de precio-por-unidad de la card.
  const ppu = parsePpu(card.ppuNodes?.[0]);

  const offer =
    listPrice !== undefined
      ? { type: "descuento" }
      : memberPrice !== undefined
        ? { type: "club", clubOnly: true, description: "Precio Jumbo Prime" }
        : undefined;

  const url = card.href
    ? card.href.startsWith("http")
      ? card.href
      : `${siteBaseUrl}${card.href}`
    : undefined;

  return {
    store,
    id: card.id,
    name: card.name,
    brand: extractBrand(card),
    price,
    ...(listPrice !== undefined ? { listPrice } : {}),
    ...(memberPrice !== undefined ? { memberPrice } : {}),
    ...(ppu ? { unitPrice: ppu.unitPrice, unit: ppu.unit } : {}),
    ...(offer ? { offer } : {}),
    inStock: true, // la grilla de frecuentes solo muestra productos disponibles
    ...(url ? { url } : {}),
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Extrae las cards de productos del HTML autenticado de una página de
 * grilla (frecuentes/lista). Regex sobre el markup renderizado: el puente
 * de navegador entrega el `outerHTML` de la página ya hidratada.
 *
 * Nota: si el puente ya entrega `FrequentCard[]` estructuradas (camino
 * preferido, evita fragilidad de regex), usar parseFrequentCard directo.
 */
export function extractFrequentCardsFromHtml(html: string): FrequentCard[] {
  const cards: FrequentCard[] = [];
  // cada card empieza en un elemento con data-cnstrc-item-id
  const cardRegex =
    /data-cnstrc-item-name="([^"]*)"\s+data-cnstrc-item-id="(\d+)"\s+data-cnstrc-item-price="(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = cardRegex.exec(html)) !== null) {
    cards.push({ name: decodeEntities(m[1]), id: m[2], dataPrice: m[3] });
  }
  return cards;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

// Reexport para tests que quieran el helper de unidad.
export { computeUnitPrice };
