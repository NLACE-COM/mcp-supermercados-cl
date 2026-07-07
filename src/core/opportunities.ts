import { getAdapter } from "./registry.js";
import type { OfferOpts, Product, StoreId } from "./types.js";

/**
 * Oportunidades: los productos con MAYOR descuento vigente y stock real,
 * para que el modelo recomiende aprovecharlos aunque no estén en el carro.
 * Se apoya en getOffers (colección de ofertas de la cadena) y las rankea por
 * porcentaje de descuento.
 */

export interface Opportunity extends Product {
  /** Porcentaje de descuento respecto al precio normal (0-100) */
  discountPct: number;
  /** Ahorro absoluto en CLP (listPrice - price) */
  saving: number;
  /** Ahorro adicional si es socio (price - memberPrice), si aplica */
  memberSaving?: number;
}

export interface OpportunityOpts extends OfferOpts {
  /** Descuento mínimo para incluir (%). Default 0. */
  minDiscountPct?: number;
  /**
   * Ids de producto a excluir (ej. lo que el usuario ya tiene en el carro o
   * compra siempre), para destacar solo oportunidades nuevas.
   */
  excludeIds?: string[];
}

/**
 * Descuentos por sobre este umbral casi siempre son artefactos de productos
 * a granel (el precio vigente es de una porción y el "normal" es por kilo),
 * no ofertas reales. Se descartan para no recomendar oportunidades falsas.
 */
const MAX_REALISTIC_DISCOUNT_PCT = 85;

function toOpportunity(p: Product): Opportunity | null {
  // Solo cuenta como oportunidad si hay descuento real (o precio socio).
  const hasListDiscount = p.listPrice !== undefined && p.listPrice > p.price;
  const memberSaving =
    p.memberPrice !== undefined && p.memberPrice < p.price
      ? p.price - p.memberPrice
      : undefined;
  if (!hasListDiscount && memberSaving === undefined) return null;

  const saving = hasListDiscount ? p.listPrice! - p.price : 0;
  const discountPct = hasListDiscount ? Math.round((saving / p.listPrice!) * 100) : 0;

  // Filtra el falso 90% de los productos a granel (unidades mezcladas).
  if (discountPct > MAX_REALISTIC_DISCOUNT_PCT) return null;

  return {
    ...p,
    discountPct,
    saving,
    ...(memberSaving !== undefined ? { memberSaving } : {}),
  };
}

export async function findOpportunities(
  store: StoreId,
  opts: OpportunityOpts = {}
): Promise<Opportunity[]> {
  const adapter = getAdapter(store);
  // Traemos un lote amplio de ofertas para tener de dónde rankear.
  const offers = await adapter.getOffers({
    category: opts.category,
    branchId: opts.branchId,
    primeOnly: opts.primeOnly,
    limit: Math.min(50, Math.max(opts.limit ?? 20, 20)),
    page: opts.page,
  });

  const exclude = new Set(opts.excludeIds ?? []);
  const minPct = opts.minDiscountPct ?? 0;

  return (
    offers
      .filter((p) => p.inStock)
      .filter((p) => !exclude.has(p.id))
      .map(toOpportunity)
      .filter((o): o is Opportunity => o !== null)
      .filter((o) => o.discountPct >= minPct)
      // Mayor descuento primero; a igual %, mayor ahorro absoluto.
      .sort((a, b) => b.discountPct - a.discountPct || b.saving - a.saving)
      .slice(0, opts.limit ?? 20)
  );
}
