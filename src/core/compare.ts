import { getAdapter } from "./registry.js";
import { rankCandidates } from "./listBuilder.js";
import { matchScore } from "./matching.js";
import type { Product, StoreId } from "./types.js";
import {
  bridgeSession,
  getConfiguredBrowserBridge,
  storeSupportsBrowserBridge,
  type SsrBrowserBridge,
} from "../adapters/browserBridge.js";

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

/** Señal de qué tan comparable es un ítem entre cadenas. */
export interface ItemComparability {
  query: string;
  /**
   * "same" si los productos elegidos comparten EAN (mismo producto),
   * "similar" si coinciden en unidad base (comparable por precio/unidad),
   * "mixed" si difieren en unidad (comparar totales puede engañar).
   */
  confidence: "same" | "similar" | "mixed";
  /** Nombres elegidos por cada cadena, para que el modelo juzgue. */
  chosen: Array<{ store: StoreId; name: string; unit?: string }>;
  note?: string;
}

export interface CompareResult {
  items: string[];
  stores: StoreComparison[];
  /** Cadena con menor total entre las que encontraron todos los ítems */
  cheapest?: StoreId;
  /** Por ítem: qué tan justa es la comparación entre cadenas. */
  comparability: ItemComparability[];
  /** Advertencia general sobre los límites de la comparación. */
  disclaimer: string;
}

/**
 * Evalúa, por ítem, si los productos que cada cadena eligió son plausiblemente
 * el mismo (EAN), comparables (misma unidad) o dispares (unidades distintas).
 * El buscador de cada cadena resuelve el ítem por su cuenta, así que sin esto
 * "aceite" podría comparar 1 L en una cadena vs. 500 ml en otra.
 */
function analyzeComparability(
  items: string[],
  comparisons: StoreComparison[]
): ItemComparability[] {
  return items.map((query, i) => {
    const picks = comparisons
      .map((c) => ({ store: c.store, product: c.items[i]?.product ?? null }))
      .filter((p): p is { store: StoreId; product: Product } => p.product !== null);

    const chosen = picks.map((p) => ({
      store: p.store,
      name: p.product.name,
      unit: p.product.unit,
    }));

    const eans = picks.map((p) => p.product.ean).filter(Boolean);
    const units = new Set(picks.map((p) => p.product.unit).filter(Boolean));

    let confidence: ItemComparability["confidence"] = "similar";
    let note: string | undefined;
    if (eans.length >= 2 && new Set(eans).size === 1) {
      confidence = "same";
    } else if (units.size > 1) {
      confidence = "mixed";
      note =
        "Las cadenas eligieron formatos con distinta unidad; el total puede no ser comparable. " +
        "Mira el precio por unidad (unitPrice) de cada uno.";
    }
    return { query, confidence, chosen, ...(note ? { note } : {}) };
  });
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
  branchId?: string,
  bridge?: SsrBrowserBridge
): Promise<StoreComparison> {
  const adapter = getAdapter(store);
  const results: StoreItemResult[] = [];
  // Cadenas SSR con antibot (Líder/Tottus): sin puente el fetch plano se bloquea
  // y la cadena queda en error. Con un puente configurado, se resuelve la
  // búsqueda por el navegador del usuario (mismo patrón que search_products).
  const session =
    bridge && storeSupportsBrowserBridge(store)
      ? bridgeSession(store, bridge, branchId)
      : undefined;
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
          ...(session ? { session } : {}),
        });
        // Descarta candidatos que no matchean la query (ruido del buscador):
        // así no comparamos un producto que ni siquiera es lo pedido. Si el
        // filtro deja todo fuera, caemos al ranking crudo (mejor algo que nada).
        const relevant = candidates.filter((p) => matchScore(query, p.name) >= 0.5);
        const pool = relevant.length > 0 ? relevant : candidates;
        results.push({ query, product: rankCandidates(pool)[0] ?? null });
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
  onProgress?: CompareProgressFn,
  bridge: SsrBrowserBridge | undefined = getConfiguredBrowserBridge()
): Promise<CompareResult> {
  // En paralelo por cadena; cada una serializa internamente por rate limit.
  // El puente (Playwright configurado) resuelve Líder/Tottus si está presente.
  let done = 0;
  const comparisons = await Promise.all(
    stores.map((s) =>
      compareOneStore(s, items, branchId, bridge).then(async (c) => {
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
  const complete = comparisons.filter((c) => !c.error && c.matched === items.length);
  const cheapest =
    complete.length > 0
      ? complete.reduce((a, b) => (a.total <= b.total ? a : b)).store
      : undefined;

  return {
    items,
    stores: comparisons,
    cheapest,
    comparability: analyzeComparability(items, comparisons),
    disclaimer:
      "Cada cadena resuelve el ítem por su cuenta: el 'más barato' puede ser un " +
      "producto/formato distinto entre cadenas. Revisa `comparability` y compara por " +
      "precio por unidad (unitPrice), no solo por total.",
  };
}
