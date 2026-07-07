import type { StoreAdapter } from "../adapters/base.js";
import { matchScore } from "./matching.js";
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

/** Un ajuste hecho para caber en el presupuesto: se bajó a una alternativa. */
export interface BudgetAdjustment {
  query: string;
  from: string;
  to: string;
  /** CLP ahorrados con el cambio. */
  saved: number;
}

export interface BudgetInfo {
  /** Presupuesto máximo pedido (CLP). */
  max: number;
  /** true si, incluso tras ajustar, el total sigue por sobre el presupuesto. */
  overBudget: boolean;
  /** Cuánto se pasa (CLP), 0 si cabe. */
  over: number;
  /** Cambios a alternativas más baratas aplicados para caber. */
  adjustments: BudgetAdjustment[];
  /** Si aún se pasa: ítems más caros que convendría quitar (orden desc). */
  dropSuggestions: Array<{ query: string; name: string; price: number }>;
}

export interface BuildListResult {
  items: ResolvedItem[];
  /** Suma de precios de los elegidos */
  total: number;
  /** Suma de ahorros por ofertas de los elegidos */
  totalSaving: number;
  /** Presente si se pidió un presupuesto máximo (opts.maxBudget). */
  budget?: BudgetInfo;
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
  /** Solo considerar productos en oferta (con descuento respecto al normal). */
  onlyOffers?: boolean;
  /** Solo considerar productos con stock real (descarta sin stock). */
  onlyInStock?: boolean;
  /**
   * Presupuesto máximo en CLP. Si el total lo supera, se baja a alternativas
   * más baratas por ítem (sin tocar los frecuentes del usuario) y, si aún se
   * pasa, se sugiere qué quitar. No elimina ítems por su cuenta.
   */
  maxBudget?: number;
}

/** ¿El producto está en oferta? (precio vigente < precio normal, o tiene offer). */
function isOnOffer(p: Product): boolean {
  return (p.listPrice !== undefined && p.listPrice > p.price) || p.offer !== undefined;
}

/**
 * ¿Alguno de los frecuentes matchea la query? Usa el matching en español
 * (plurales, tildes, sinónimos/regionalismos): exige cubrir todos los tokens
 * significativos de la query. Así "palta" encuentra "Aguacate Hass" y
 * "huevos" encuentra "Huevo", cosa que el match literal antiguo perdía.
 */
export function matchFrequent(query: string, frequent: Product[]): Product | undefined {
  const matches = frequent
    .filter((p) => p.inStock)
    .filter((p) => matchScore(query, p.name) >= 1);
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
    // Con filtros pedimos más candidatos para no quedarnos cortos al filtrar.
    limit: opts.onlyOffers || opts.onlyInStock ? 20 : (opts.perItemLimit ?? 8),
    branchId: opts.branchId,
  });

  // Filtros opcionales antes de rankear. onlyInStock ya lo cubre
  // rankCandidates (descarta sin stock), pero lo dejamos explícito.
  let filtered = candidates;
  if (opts.onlyInStock) filtered = filtered.filter((p) => p.inStock);
  if (opts.onlyOffers) filtered = filtered.filter(isOnOffer);

  const ranked = rankCandidates(filtered);

  // Núcleo del producto: si el usuario ya compra algo que matchea, va
  // primero, aunque el buscador lo rankee más abajo. Respeta onlyOffers.
  let frequentMatch = opts.frequentProducts
    ? matchFrequent(query, opts.frequentProducts)
    : undefined;
  if (frequentMatch && opts.onlyOffers && !isOnOffer(frequentMatch)) {
    frequentMatch = undefined;
  }

  const chosen = frequentMatch ?? ranked[0] ?? null;
  // Alternativas: el ranking por conveniencia, sin repetir al elegido.
  const alternatives = ranked.filter((p) => p.id !== chosen?.id).slice(0, 3);

  const noResultNote = opts.onlyOffers
    ? "Sin productos en oferta con stock para este ítem."
    : "Sin resultados con stock para este ítem.";

  return {
    query,
    chosen,
    alternatives,
    saving: chosen?.listPrice ? chosen.listPrice - chosen.price : 0,
    ...(frequentMatch ? { fromFrequent: true } : {}),
    ...(chosen === null ? { note: noResultNote } : {}),
    ...(!frequentMatch && chosen && ranked.length > 1 && !chosen.unitPrice
      ? { note: "Elegido por precio absoluto (sin precio por unidad comparable)." }
      : {}),
  };
}

/** Callback de progreso (para notificar al cliente MCP ítem a ítem). */
export type BuildProgressFn = (
  done: number,
  total: number,
  message: string
) => void | Promise<void>;

export async function buildList(
  adapter: StoreAdapter,
  queries: string[],
  opts: ResolveOpts = {},
  onProgress?: BuildProgressFn
): Promise<BuildListResult> {
  const items: ResolvedItem[] = [];
  // Secuencial a propósito: el rate limit por host ya serializa, y así la
  // lista mantiene ritmo humano.
  for (const [i, query] of queries.entries()) {
    await onProgress?.(
      i,
      queries.length,
      `Buscando "${query}" (${i + 1}/${queries.length})…`
    );
    items.push(await resolveItem(adapter, query, opts));
  }
  await onProgress?.(
    queries.length,
    queries.length,
    "Ítems resueltos; calculando totales…"
  );
  const budget =
    opts.maxBudget !== undefined ? applyBudget(items, opts.maxBudget) : undefined;

  const total = items.reduce((sum, i) => sum + (i.chosen?.price ?? 0), 0);
  const totalSaving = items.reduce((sum, i) => sum + i.saving, 0);
  return { items, total, totalSaving, ...(budget ? { budget } : {}) };
}

/**
 * Ajusta la lista para caber en el presupuesto: por cada ítem (salvo los
 * frecuentes del usuario, que se respetan) baja a la alternativa más barata
 * que ayude, priorizando los cambios de mayor ahorro. Muta `items` (cambia el
 * elegido) y devuelve el detalle. Si aún se pasa, sugiere qué quitar.
 */
function applyBudget(items: ResolvedItem[], maxBudget: number): BudgetInfo {
  const totalOf = () => items.reduce((s, i) => s + (i.chosen?.price ?? 0), 0);
  const adjustments: BudgetAdjustment[] = [];

  // Candidatos a bajar de precio: ítem con una alternativa más barata,
  // ordenados por el mayor ahorro posible primero.
  const swappable = items
    .filter((i) => i.chosen && !i.fromFrequent)
    .map((i) => {
      const cheaper = i.alternatives
        .filter((a) => a.price < (i.chosen as Product).price)
        .sort((a, b) => a.price - b.price)[0];
      return cheaper ? { item: i, cheaper } : null;
    })
    .filter((x): x is { item: ResolvedItem; cheaper: Product } => x !== null)
    .sort(
      (a, b) =>
        (b.item.chosen as Product).price -
        b.cheaper.price -
        ((a.item.chosen as Product).price - a.cheaper.price)
    );

  for (const { item, cheaper } of swappable) {
    if (totalOf() <= maxBudget) break;
    const prev = item.chosen as Product;
    const saved = prev.price - cheaper.price;
    item.chosen = cheaper;
    item.alternatives = [
      prev,
      ...item.alternatives.filter((a) => a.id !== cheaper.id),
    ].slice(0, 3);
    item.saving = cheaper.listPrice ? cheaper.listPrice - cheaper.price : 0;
    item.note = "Ajustado a una alternativa más barata para caber en el presupuesto.";
    adjustments.push({ query: item.query, from: prev.name, to: cheaper.name, saved });
  }

  const total = totalOf();
  const over = Math.max(0, total - maxBudget);
  const dropSuggestions =
    over > 0
      ? items
          .filter((i) => i.chosen)
          .sort((a, b) => (b.chosen as Product).price - (a.chosen as Product).price)
          .slice(0, 3)
          .map((i) => ({
            query: i.query,
            name: (i.chosen as Product).name,
            price: (i.chosen as Product).price,
          }))
      : [];

  return { max: maxBudget, overBudget: over > 0, over, adjustments, dropSuggestions };
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

export interface SwapOpts extends ResolveOpts {
  /**
   * Modo "más natural manteniendo el precio": en vez de exigir mejor precio
   * por unidad, considera alternativas de precio SIMILAR (dentro de la
   * tolerancia) y trae sus ingredientes/sellos para que el modelo elija la
   * más natural (menos ingredientes). Requiere que el adaptador exponga la
   * ficha (get_product): hoy Jumbo y Santa Isabel.
   */
  preferNatural?: boolean;
  /** Tolerancia de precio por unidad para "similar" (default 0.20 = ±20%). */
  priceTolerance?: number;
}

export interface Swap {
  /** Ítem original (texto o nombre del producto actual) */
  query: string;
  /** Producto que el usuario tiene hoy (mejor match de la búsqueda) */
  current: Product | null;
  /** Alternativas (por precio por unidad, o similares si preferNatural) */
  swaps: Array<Product & { savingPerUnit: number }>;
  note?: string;
}

/**
 * Reemplazos más convenientes dentro del mismo catálogo: misma búsqueda,
 * mejor precio por unidad que el producto actual. Con `preferNatural`,
 * cambia el criterio a "precio similar + ingredientes" para elegir lo más
 * natural sin subir el gasto.
 */
export async function suggestSwaps(
  adapter: StoreAdapter,
  query: string,
  opts: SwapOpts = {}
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

  if (opts.preferNatural) {
    return suggestNaturalSwaps(adapter, query, current, inStock, opts);
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

/**
 * Alternativas de precio similar enriquecidas con ingredientes, para el
 * juicio "más natural / menos ingredientes" manteniendo el precio.
 */
async function suggestNaturalSwaps(
  adapter: StoreAdapter,
  query: string,
  current: Product,
  inStock: Product[],
  opts: SwapOpts
): Promise<Swap> {
  const tol = opts.priceTolerance ?? 0.2;
  const maxUnit = current.unitPrice! * (1 + tol);

  // Candidatos de precio por unidad similar o menor (no más caros que la
  // tolerancia), misma unidad, ordenados por precio por unidad.
  const near = inStock
    .filter(
      (p) =>
        p.id !== current.id &&
        p.unit === current.unit &&
        p.unitPrice !== undefined &&
        p.unitPrice <= maxUnit
    )
    .sort((a, b) => a.unitPrice! - b.unitPrice!)
    .slice(0, 4);

  // Enriquecer con ingredientes (getProduct) el actual y los candidatos.
  const withIngredients = await enrichIngredients(adapter, [current, ...near]);
  const [enrichedCurrent, ...enrichedNear] = withIngredients;

  const swaps = enrichedNear.map((p) => ({
    ...p,
    savingPerUnit: current.unitPrice! - p.unitPrice!,
  }));

  return {
    query,
    current: enrichedCurrent,
    swaps,
    note:
      "Modo natural: alternativas de precio similar con sus ingredientes. " +
      "Elige la de lista de ingredientes más corta/limpia según tu criterio.",
  };
}

/** Trae ingredients/nutritionalFlags de cada producto vía get_product. */
async function enrichIngredients(
  adapter: StoreAdapter,
  products: Product[]
): Promise<Product[]> {
  const out: Product[] = [];
  for (const p of products) {
    if (p.ingredients || !p.url) {
      out.push(p);
      continue;
    }
    try {
      const detail = await adapter.getProduct(p.url);
      out.push(
        detail
          ? {
              ...p,
              ...(detail.ingredients ? { ingredients: detail.ingredients } : {}),
              ...(detail.nutritionalFlags
                ? { nutritionalFlags: detail.nutritionalFlags }
                : {}),
              ...(detail.description ? { description: detail.description } : {}),
            }
          : p
      );
    } catch {
      out.push(p);
    }
  }
  return out;
}
