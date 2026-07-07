import { getAdapter } from "./registry.js";
import { rankCandidates } from "./listBuilder.js";
import type { Product, StoreId } from "./types.js";

/**
 * Comparación entre cadenas (fase 7, capacidad secundaria del plan). Para
 * cada ítem busca en cada cadena y elige el mejor candidato por precio; luego
 * estima el total de la lista por cadena. No pretende matching perfecto: da
 * el mejor match por cadena y deja el juicio final al modelo.
 */

export interface StoreItemResult {
  query: string;
  product: Product | null;
}

export interface StoreComparison {
  store: StoreId;
  /** Ítems resueltos en esta cadena */
  items: StoreItemResult[];
  /** Cuántos ítems se encontraron con stock */
  matched: number;
  /** Total estimado de los ítems encontrados (CLP) */
  total: number;
  /** Nota si la cadena falló (endpoint caído, bloqueo, etc.) */
  error?: string;
}

export interface CompareResult {
  items: string[];
  stores: StoreComparison[];
  /** Cadena con menor total entre las que encontraron todos los ítems */
  cheapest?: StoreId;
}

async function compareOneStore(
  store: StoreId,
  items: string[],
  branchId?: string
): Promise<StoreComparison> {
  const adapter = getAdapter(store);
  const results: StoreItemResult[] = [];
  try {
    for (const query of items) {
      const candidates = await adapter.searchProducts(query, {
        limit: 8,
        branchId,
      });
      const best = rankCandidates(candidates)[0] ?? null;
      results.push({ query, product: best });
    }
  } catch (err) {
    return {
      store,
      items: results,
      matched: results.filter((r) => r.product).length,
      total: results.reduce((s, r) => s + (r.product?.price ?? 0), 0),
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return {
    store,
    items: results,
    matched: results.filter((r) => r.product).length,
    total: results.reduce((s, r) => s + (r.product?.price ?? 0), 0),
  };
}

export async function compareStores(
  items: string[],
  stores: StoreId[],
  branchId?: string
): Promise<CompareResult> {
  // En paralelo por cadena; cada una serializa internamente por rate limit.
  const comparisons = await Promise.all(
    stores.map((s) => compareOneStore(s, items, branchId))
  );

  // Cadena más barata entre las que encontraron TODOS los ítems.
  const complete = comparisons.filter(
    (c) => !c.error && c.matched === items.length
  );
  const cheapest =
    complete.length > 0
      ? complete.reduce((a, b) => (a.total <= b.total ? a : b)).store
      : undefined;

  return { items, stores: comparisons, cheapest };
}
