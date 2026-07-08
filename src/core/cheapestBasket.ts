import type { CompareResult } from "./compare.js";
import type { Product, StoreId } from "./types.js";

/**
 * "Canasta más barata repartida": a diferencia de compare_stores (que estima el
 * total de la lista COMPLETA por cadena y elige una sola), aquí se asigna CADA
 * ítem a la cadena donde sale más barato y se agrupa la compra por cadena. Es
 * el "cherry-pick": la leche en la cadena X, el pan en la Y.
 *
 * Función pura sobre el resultado de compare_stores para poder testearla sin red.
 */

export interface BasketAlternative {
  store: StoreId;
  name: string;
  price: number;
  unitPrice?: number;
  unit?: string;
}

export interface BasketPick {
  query: string;
  store: StoreId;
  name: string;
  price: number;
  unitPrice?: number;
  unit?: string;
  url?: string;
  /** Métrica con la que se eligió entre cadenas (por ítem). */
  by: "unitPrice" | "price";
  /** Las otras cadenas que también tenían el ítem, para transparencia. */
  alternatives: BasketAlternative[];
}

export interface StorePlan {
  store: StoreId;
  items: BasketPick[];
  /** Suma de `price` de los ítems asignados a esta cadena (CLP). */
  subtotal: number;
}

export interface CheapestBasket {
  /** Por ítem: dónde comprarlo más barato. */
  picks: BasketPick[];
  /** Agrupado por cadena: qué comprar en cada una. */
  plan: StorePlan[];
  /** Ítems sin match en ninguna cadena consultada. */
  missing: string[];
  /** Total comprando cada ítem donde es más barato (CLP). */
  basketTotal: number;
  /** Mejor cadena única (comprar todo en una), si compare_stores la determinó. */
  singleStore?: { store: StoreId; total: number };
  /** Ahorro de repartir la compra vs comprar todo en la cadena única más barata. */
  splitSaving: number;
  /** Ítems cuyo formato difiere entre cadenas (comparar con cuidado). */
  mixedFormatItems: string[];
  disclaimer: string;
}

export function chooseCheapestBasket(cmp: CompareResult): CheapestBasket {
  const activeStores = cmp.stores.filter((s) => !s.error);
  const picks: BasketPick[] = [];
  const missing: string[] = [];

  cmp.items.forEach((query, i) => {
    const candidates = activeStores
      .map((s) => ({ store: s.store, product: s.items[i]?.product ?? null }))
      .filter((c): c is { store: StoreId; product: Product } => c.product !== null);

    if (candidates.length === 0) {
      missing.push(query);
      return;
    }

    // Comparar por precio/unidad solo si TODOS los candidatos lo informan; si no,
    // por precio absoluto (métrica consistente por ítem, sin mezclar peras y kilos).
    const allHaveUnit = candidates.every((c) => c.product.unitPrice !== undefined);
    const by: "unitPrice" | "price" = allHaveUnit ? "unitPrice" : "price";
    const value = (p: Product) =>
      by === "unitPrice" ? (p.unitPrice ?? p.price) : p.price;

    const best = candidates.reduce((a, b) =>
      value(a.product) <= value(b.product) ? a : b
    );
    const alternatives = candidates
      .filter((c) => c.store !== best.store)
      .map((c) => ({
        store: c.store,
        name: c.product.name,
        price: c.product.price,
        ...(c.product.unitPrice !== undefined
          ? { unitPrice: c.product.unitPrice }
          : {}),
        ...(c.product.unit ? { unit: c.product.unit } : {}),
      }));

    picks.push({
      query,
      store: best.store,
      name: best.product.name,
      price: best.product.price,
      ...(best.product.unitPrice !== undefined
        ? { unitPrice: best.product.unitPrice }
        : {}),
      ...(best.product.unit ? { unit: best.product.unit } : {}),
      ...(best.product.url ? { url: best.product.url } : {}),
      by,
      alternatives,
    });
  });

  const byStore = new Map<StoreId, BasketPick[]>();
  for (const p of picks) {
    const arr = byStore.get(p.store) ?? [];
    arr.push(p);
    byStore.set(p.store, arr);
  }
  const plan: StorePlan[] = [...byStore.entries()].map(([store, storeItems]) => ({
    store,
    items: storeItems,
    subtotal: storeItems.reduce((s, it) => s + it.price, 0),
  }));

  const basketTotal = picks.reduce((s, p) => s + p.price, 0);

  const singleStore = cmp.cheapest
    ? {
        store: cmp.cheapest,
        total: cmp.stores.find((s) => s.store === cmp.cheapest)?.total ?? 0,
      }
    : undefined;
  const splitSaving = singleStore ? Math.max(0, singleStore.total - basketTotal) : 0;

  const mixedFormatItems = cmp.comparability
    .filter((c) => c.confidence === "mixed")
    .map((c) => c.query);

  return {
    picks,
    plan,
    missing,
    basketTotal,
    ...(singleStore ? { singleStore } : {}),
    splitSaving,
    mixedFormatItems,
    disclaimer:
      "Cada ítem se asigna a la cadena donde sale más barato (por precio/unidad cuando " +
      "todas lo informan). Revisa mixedFormatItems: ahí los formatos difieren y conviene " +
      "mirar el precio por unidad. Armar el carro automático hoy solo aplica a Jumbo (con " +
      "sesión); para el resto quedan la lista y los links.",
  };
}
