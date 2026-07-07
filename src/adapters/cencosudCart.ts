import { computeUnitPrice, toClp } from "../core/normalize.js";
import type { Cart, CartLine, Product, StoreId } from "../core/types.js";

/**
 * Normalización del carro de Cencosud (Jumbo). Endpoints verificados
 * 2026-07-07 con la sesión del usuario:
 *   GET   /cart?store={branchId}&simulationTotals=true   (leer)
 *   PATCH /cart/items                                     (agregar/actualizar)
 *
 * El precio socio del carro sale de dos lugares que se cruzan:
 *  - por línea: promotions[] con userProperties "PRIME_USER" (unitPrice).
 *  - agregado: totals.itemDiscounts.details / simulation.*.discountDetails
 *    separan el descuento "ALL" del "PRIME_USER".
 */

interface RawCartItem {
  skuId?: string;
  productId?: string;
  name?: string;
  brand?: string;
  quantity?: number;
  status?: string;
  measurementUnitUn?: string;
  unitMultiplierUn?: number;
  prices?: {
    listPrice?: number;
    totalListPrice?: number;
    price?: number;
    totalPrice?: number;
  };
  promotions?: Array<{
    unitPrice?: number;
    userProperties?: string;
    applied?: boolean;
  }>;
}

interface RawCart {
  items?: RawCartItem[];
  itemsQuantity?: number;
  totals?: {
    subTotal?: number;
    total?: number;
    itemDiscounts?: {
      value?: number;
      details?: Array<{ key?: string; value?: number }>;
    };
  };
}

/** Item del carro -> Product normalizado (precio vigente + Prime separado). */
export function cartItemToProduct(raw: RawCartItem, store: StoreId): Product | null {
  const id = raw.skuId ?? raw.productId;
  if (!id || !raw.name) return null;

  const price = toClp(raw.prices?.price) ?? toClp(raw.prices?.listPrice);
  if (price === undefined) return null;
  let listPrice = toClp(raw.prices?.listPrice);
  if (listPrice !== undefined && listPrice <= price) listPrice = undefined;

  // Precio socio: promo PRIME_USER (aplicada o no, es el precio que pagaría).
  const primePromo = raw.promotions?.find((p) => p.userProperties === "PRIME_USER");
  const memberPrice = toClp(primePromo?.unitPrice);

  const unit = raw.measurementUnitUn;
  const unitPrice = computeUnitPrice(price, raw.unitMultiplierUn);

  return {
    store,
    id,
    name: raw.name,
    brand: raw.brand || undefined,
    price,
    ...(listPrice !== undefined ? { listPrice } : {}),
    ...(memberPrice !== undefined ? { memberPrice } : {}),
    ...(unitPrice !== undefined ? { unitPrice } : {}),
    ...(unit ? { unit } : {}),
    inStock: raw.status !== "unavailable",
    fetchedAt: new Date().toISOString(),
  };
}

/** JSON crudo de GET /cart -> Cart normalizado. */
export function parseCart(raw: unknown, store: StoreId): Cart {
  const cart = (raw ?? {}) as RawCart;
  const rawItems = cart.items ?? [];

  const items: CartLine[] = rawItems
    .map((it) => {
      const product = cartItemToProduct(it, store);
      if (!product) return null;
      const quantity = Math.max(1, Math.round(it.quantity ?? 1));
      const lineTotal = toClp(it.prices?.totalPrice) ?? product.price * quantity;
      return { product, quantity, lineTotal };
    })
    .filter((l): l is CartLine => l !== null);

  const subTotal = toClp(cart.totals?.subTotal) ?? sumListPrices(rawItems);
  const total = toClp(cart.totals?.total) ?? items.reduce((s, l) => s + l.lineTotal, 0);
  const savings = Math.max(0, subTotal - total);

  // Ahorro Prime: magnitud del descuento con key PRIME_USER (viene negativo).
  const primeDetail = cart.totals?.itemDiscounts?.details?.find(
    (d) => d.key === "PRIME_USER"
  );
  const primeSavings =
    primeDetail?.value !== undefined
      ? Math.abs(Math.round(primeDetail.value))
      : undefined;

  const itemsQuantity = cart.itemsQuantity ?? items.reduce((s, l) => s + l.quantity, 0);

  return {
    store,
    items,
    itemsQuantity,
    subTotal,
    total,
    savings,
    ...(primeSavings !== undefined ? { primeSavings } : {}),
  };
}

/**
 * Arma el body del PATCH /cart/items tal como lo envía el frontend
 * (verificado 2026-07-07). Los campos más allá de skuId/quantity son
 * banderas que el sitio manda con estos defaults para productos normales.
 */
export function buildCartPatchBody(
  lines: Array<{
    skuId: string;
    quantity: number;
    measurementUnitUn?: string;
    unitMultiplierUn?: number;
    itemQuantityLimit?: number;
    soldBy?: string;
  }>,
  branchId: string
) {
  return {
    items: lines.map((l) => ({
      skuId: l.skuId,
      quantity: l.quantity,
      isUnitary: false,
      giftable: false,
      itemQuantityLimit: l.itemQuantityLimit ?? 40,
      isUnitaryEligible: false,
      sponsoredId: null,
      measurementUnitUn: l.measurementUnitUn ?? "un",
      unitMultiplierUn: l.unitMultiplierUn ?? 1,
      soldBy: l.soldBy ?? "Jumbo",
    })),
    store: branchId,
  };
}

/** Endpoint del BFF de Jumbo para leer/mutar el carro. */
export const CART_BFF_BASE = "https://be-reg-groceries-bff-jumbo.ecomm.cencosud.com";

function sumListPrices(items: RawCartItem[]): number {
  return items.reduce((s, it) => {
    const lp =
      toClp(it.prices?.totalListPrice) ??
      (toClp(it.prices?.listPrice) ?? 0) * (it.quantity ?? 1);
    return s + (lp ?? 0);
  }, 0);
}
