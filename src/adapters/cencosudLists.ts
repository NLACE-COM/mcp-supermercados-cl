import { computeUnitPrice, toClp } from "../core/normalize.js";
import type { Product, ShoppingList, StoreId } from "../core/types.js";

/**
 * Normalización de las listas guardadas de Jumbo. Verificado 2026-07-07:
 * el detalle de una lista (GET /lists/{scope}/{idList}) trae
 * `{idList, name, items[], isFavorite}` donde cada item es un producto con
 * `{idItem, name, price, listPrice, quantity, promotions[], stock,
 * measurementUnit, unitMultiplier}`. El precio socio sale de la promo con
 * userProperties "PRIME_USER" (igual que carro/PDP).
 *
 * El puente de navegador entrega el JSON crudo; aquí se normaliza a
 * ShoppingList (metadatos + items) y se exponen los productos.
 */

interface RawListItem {
  idItem?: string;
  name?: string;
  brand?: string;
  price?: number;
  listPrice?: number;
  quantity?: number;
  stock?: boolean;
  measurementUnit?: string;
  unitMultiplier?: number;
  promotions?: Array<{ unitPrice?: number; userProperties?: unknown }>;
}

interface RawList {
  idList?: string;
  name?: string;
  isFavorite?: boolean;
  items?: RawListItem[];
}

/** Un item de lista -> Product normalizado (con precio Prime si aplica). */
export function listItemToProduct(raw: RawListItem, store: StoreId): Product | null {
  if (!raw.idItem || !raw.name) return null;
  const price = toClp(raw.price);
  if (price === undefined) return null;
  let listPrice = toClp(raw.listPrice);
  if (listPrice !== undefined && listPrice <= price) listPrice = undefined;

  const primePromo = (raw.promotions ?? []).find(
    (p) => p.userProperties === "PRIME_USER"
  );
  const memberPrice = toClp(primePromo?.unitPrice);
  const unitPrice = computeUnitPrice(price, raw.unitMultiplier);

  return {
    store,
    id: raw.idItem,
    name: raw.name,
    brand: raw.brand || undefined,
    price,
    ...(listPrice !== undefined ? { listPrice } : {}),
    ...(memberPrice !== undefined ? { memberPrice } : {}),
    ...(unitPrice !== undefined ? { unitPrice } : {}),
    ...(raw.measurementUnit ? { unit: raw.measurementUnit } : {}),
    ...(listPrice !== undefined ? { offer: { type: "descuento" } } : {}),
    inStock: raw.stock !== false,
    fetchedAt: new Date().toISOString(),
  };
}

/** Normaliza el JSON crudo a ShoppingList (una lista o un arreglo de listas). */
export function parseShoppingLists(raw: unknown, store: StoreId): ShoppingList[] {
  const lists: RawList[] = Array.isArray(raw)
    ? (raw as RawList[])
    : raw && typeof raw === "object"
      ? [raw as RawList]
      : [];

  return lists
    .filter((l) => l.idList && l.name)
    .map((l) => ({
      store,
      id: l.idList as string,
      name: l.name as string,
      items: (l.items ?? [])
        .filter((it) => it.idItem)
        .map((it) => ({
          productId: it.idItem as string,
          quantity: Math.max(1, Math.round(it.quantity ?? 1)),
        })),
    }));
}

/** Productos de las listas guardadas (para priorizar en build_list, etc.). */
export function listsToProducts(raw: unknown, store: StoreId): Product[] {
  const lists: RawList[] = Array.isArray(raw)
    ? (raw as RawList[])
    : raw && typeof raw === "object"
      ? [raw as RawList]
      : [];
  const products: Product[] = [];
  for (const l of lists) {
    for (const it of l.items ?? []) {
      const p = listItemToProduct(it, store);
      if (p) products.push(p);
    }
  }
  return products;
}
