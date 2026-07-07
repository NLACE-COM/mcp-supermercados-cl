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

/**
 * Presupuesto de tiempo por cadena: una cadena caída o bloqueada (timeouts,
 * reintentos) no debe retrasar el resultado de las demás. Al agotarse, se
 * devuelve lo resuelto hasta ahí con `error` explicando el parcial.
 */
const STORE_BUDGET_MS = 25_000;

/** Callback de progreso (para notificar al cliente MCP mientras se compara). */
export type CompareProgressFn = (
  done: number,
  total: number,
  message: string
) => void | Promise<void>;

async function compareOneStore(
  store: StoreId,
  items: string[],
  branchId?: string
): Promise<StoreComparison> {
  const adapter = getAdapter(store);
  const results: StoreItemResult[] = [];
  const summary = (error?: string): StoreComparison => ({
    store,
    items: [...results],
    matched: results.filter((r) => r.product).length,
    total: results.reduce((s, r) => s + (r.product?.price ?? 0), 0),
    ...(error ? { error } : {}),
  });

  // `expired` corta el loop en el siguiente ítem; la carrera cubre además
  // el caso de una request colgada a mitad de ítem.
  let expired = false;
  const run = (async () => {
    try {
      for (const query of items) {
        if (expired) break;
        const candidates = await adapter.searchProducts(query, {
          limit: 8,
          branchId,
        });
        results.push({ query, product: rankCandidates(candidates)[0] ?? null });
      }
      return summary();
    } catch (err) {
      return summary(err instanceof Error ? err.message : String(err));
    }
  })();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<StoreComparison>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      resolve(
        summary(
          `No alcanzó a resolver todos los ítems en ${STORE_BUDGET_MS / 1000}s; resultado parcial.`
        )
      );
    }, STORE_BUDGET_MS);
  });

  try {
    return await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function compareStores(
  items: string[],
  stores: StoreId[],
  branchId?: string,
  onProgress?: CompareProgressFn
): Promise<CompareResult> {
  // En paralelo por cadena; cada una serializa internamente por rate limit.
  let done = 0;
  const comparisons = await Promise.all(
    stores.map((s) =>
      compareOneStore(s, items, branchId).then(async (c) => {
        done += 1;
        await onProgress?.(
          done,
          stores.length,
          `${s}: ${c.matched}/${items.length} ítems${c.error ? " (con error)" : ""} — ${done}/${stores.length} cadenas listas`
        );
        return c;
      })
    )
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
