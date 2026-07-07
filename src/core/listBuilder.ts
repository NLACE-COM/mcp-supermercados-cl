import type { StoreAdapter } from "../adapters/base.js";
import { normalizeText } from "./normalize.js";
import type { Product, Session } from "./types.js";

/**
 * Lógica de armado de lista (fase 3). Versión pública: resuelve ítems en
 * lenguaje natural a productos concretos priorizando precio por unidad y
 * ofertas. En fase 2 se antepondrá el historial del usuario
 * (getFrequentPurchases) a este ranking.
 */

export interface ResolvedItem {
  /** Texto original del usuario, ej. "leche descremada" */
  query: string;
  /** Producto elegido, null si no hubo resultados con stock */
  chosen: Product | null;
  /** Alternativas razonables, ordenadas por conveniencia */
  alternatives: Product[];
  /** Ahorro en CLP del elegido si está en oferta (listPrice - price) */
  saving: number;
  /** true si el elegido es un producto que el usuario ya compra (frecuente) */
  fromFrequent?: boolean;
  /** Nota cuando algo requiere juicio del usuario/modelo */
  note?: string;
}

export interface BuildListResult {
  items: ResolvedItem[];
  /** Suma de precios de los elegidos */
  total: number;
  /** Suma de ahorros por ofertas de los elegidos */
  totalSaving: number;
}

export interface ResolveOpts {
  branchId?: string;
  /** Candidatos a traer por ítem (default 8) */
  perItemLimit?: number;
  /**
   * Productos frecuentes del usuario. Si un ítem hace match con uno de
   * estos, se prioriza (es el núcleo del producto: armar la lista con lo
   * que la persona realmente compra). Se llenan con getFrequentPurchases.
   */
  frequentProducts?: Product[];
}

/**
 * ¿Alguno de los frecuentes matchea la query? Match laxo: todas las
 * palabras significativas de la query aparecen en el nombre del frecuente.
 */
export function matchFrequent(
  query: string,
  frequent: Product[]
): Product | undefined {
  const words = normalizeText(query)
    .split(/\s+/)
    .filter((w) => w.length > 2);
  if (words.length === 0) return undefined;

  const matches = frequent
    .filter((p) => p.inStock)
    .filter((p) => {
      const name = normalizeText(p.name);
      return words.every((w) => name.includes(w));
    });
  if (matches.length === 0) return undefined;

  // Entre los frecuentes que matchean, el de mejor precio por unidad (o
  // precio absoluto si no hay unidad comparable).
  return matches.sort((a, b) => {
    if (a.unitPrice !== undefined && b.unitPrice !== undefined) {
      return a.unitPrice - b.unitPrice;
    }
    return a.price - b.price;
  })[0];
}

/**
 * Ordena candidatos por conveniencia: menor precio por unidad primero
 * (cuando la unidad predominante coincide), luego menor precio absoluto.
 * No pretende juicio perfecto: las alternativas van incluidas para que el
 * modelo decida con contexto.
 */
export function rankCandidates(products: Product[]): Product[] {
  const inStock = products.filter((p) => p.inStock);
  if (inStock.length === 0) return [];

  // Unidad predominante entre los candidatos (kg, lt, un...):
  const unitCounts = new Map<string, number>();
  for (const p of inStock) {
    if (p.unit && p.unitPrice !== undefined) {
      unitCounts.set(p.unit, (unitCounts.get(p.unit) ?? 0) + 1);
    }
  }
  const dominantUnit = [...unitCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const comparable = dominantUnit
    ? inStock.filter((p) => p.unit === dominantUnit && p.unitPrice !== undefined)
    : [];
  const rest = inStock.filter((p) => !comparable.includes(p));

  comparable.sort((a, b) => a.unitPrice! - b.unitPrice!);
  rest.sort((a, b) => a.price - b.price);
  return [...comparable, ...rest];
}

export async function resolveItem(
  adapter: StoreAdapter,
  query: string,
  opts: ResolveOpts = {}
): Promise<ResolvedItem> {
  const candidates = await adapter.searchProducts(query, {
    limit: opts.perItemLimit ?? 8,
    branchId: opts.branchId,
  });
  const ranked = rankCandidates(candidates);

  // Núcleo del producto: si el usuario ya compra algo que matchea, va
  // primero, aunque el buscador lo rankee más abajo.
  const frequentMatch = opts.frequentProducts
    ? matchFrequent(query, opts.frequentProducts)
    : undefined;

  const chosen = frequentMatch ?? ranked[0] ?? null;
  // Alternativas: el ranking por conveniencia, sin repetir al elegido.
  const alternatives = ranked.filter((p) => p.id !== chosen?.id).slice(0, 3);

  return {
    query,
    chosen,
    alternatives,
    saving: chosen?.listPrice ? chosen.listPrice - chosen.price : 0,
    ...(frequentMatch ? { fromFrequent: true } : {}),
    ...(chosen === null
      ? { note: "Sin resultados con stock para este ítem." }
      : {}),
    ...(!frequentMatch && chosen && ranked.length > 1 && !chosen.unitPrice
      ? { note: "Elegido por precio absoluto (sin precio por unidad comparable)." }
      : {}),
  };
}

export async function buildList(
  adapter: StoreAdapter,
  queries: string[],
  opts: ResolveOpts = {}
): Promise<BuildListResult> {
  const items: ResolvedItem[] = [];
  // Secuencial a propósito: el rate limit por host ya serializa, y así la
  // lista mantiene ritmo humano.
  for (const query of queries) {
    items.push(await resolveItem(adapter, query, opts));
  }
  const total = items.reduce((sum, i) => sum + (i.chosen?.price ?? 0), 0);
  const totalSaving = items.reduce((sum, i) => sum + i.saving, 0);
  return { items, total, totalSaving };
}

/**
 * Trae los frecuentes del usuario si la sesión lo permite; si no hay
 * sesión o el adaptador no los soporta aún, devuelve [] (build_list sigue
 * funcionando en modo público). No revienta el flujo por falta de sesión.
 */
export async function loadFrequent(
  adapter: StoreAdapter,
  session?: Session
): Promise<Product[]> {
  if (!session) return [];
  try {
    return await adapter.getFrequentPurchases(session);
  } catch {
    return [];
  }
}

export interface Swap {
  /** Ítem original (texto o nombre del producto actual) */
  query: string;
  /** Producto que el usuario tiene hoy (mejor match de la búsqueda) */
  current: Product | null;
  /** Alternativas estrictamente más convenientes por precio por unidad */
  swaps: Array<Product & { savingPerUnit: number }>;
  note?: string;
}

/**
 * Reemplazos más convenientes dentro del mismo catálogo: misma búsqueda,
 * mejor precio por unidad que el producto actual.
 */
export async function suggestSwaps(
  adapter: StoreAdapter,
  query: string,
  opts: ResolveOpts = {}
): Promise<Swap> {
  const candidates = await adapter.searchProducts(query, {
    limit: opts.perItemLimit ?? 10,
    branchId: opts.branchId,
  });
  const inStock = candidates.filter((p) => p.inStock);
  // El "actual" es el mejor match textual: el primero que devuelve el
  // buscador (relevancia), no el más barato.
  const current = inStock[0] ?? null;

  if (!current) {
    return { query, current: null, swaps: [], note: "Sin resultados con stock." };
  }
  if (current.unitPrice === undefined || !current.unit) {
    return {
      query,
      current,
      swaps: [],
      note: "El producto actual no informa precio por unidad; no se puede comparar.",
    };
  }

  const swaps = inStock
    .filter(
      (p) =>
        p.id !== current.id &&
        p.unit === current.unit &&
        p.unitPrice !== undefined &&
        p.unitPrice < current.unitPrice!
    )
    .sort((a, b) => a.unitPrice! - b.unitPrice!)
    .slice(0, 4)
    .map((p) => ({ ...p, savingPerUnit: current.unitPrice! - p.unitPrice! }));

  return { query, current, swaps };
}
