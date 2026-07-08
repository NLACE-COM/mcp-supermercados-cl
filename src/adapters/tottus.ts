import { normalizeUnit, parseBundle, parseClpString } from "../core/normalize.js";
import type {
  Cart,
  CartItem,
  OfferOpts,
  Price,
  Product,
  SearchOpts,
  Session,
  ShoppingList,
} from "../core/types.js";
import { defaultHttpClient, type HttpFetcher } from "../http/client.js";
import { NotImplementedError, type StoreAdapter } from "./base.js";

/**
 * Adaptador Tottus (Falabella, Next.js SSR). Verificado 2026-07-07 desde IP
 * residencial (bloquea datacenter con 403):
 *
 *   GET https://www.tottus.cl/tottus-cl/buscar?Ntt={query}
 *
 * El HTML trae `__NEXT_DATA__` con `props.pageProps.results`: 48 productos
 * por página con displayName, brand, url, measurements y `prices[]`:
 *  - type "internetPrice": precio vigente, con `pum` (precio por unidad).
 *  - type "normalPrice" (crossed:true): precio de lista tachado.
 */

const BASE = "https://www.tottus.cl";
const NEXT_DATA_MARKER = '<script id="__NEXT_DATA__" type="application/json">';

interface TottusPrice {
  type?: string;
  crossed?: boolean;
  price?: string[];
  pum?: { label?: string; price?: string[] };
}

interface TottusProduct {
  productId?: string;
  skuId?: string;
  displayName?: string;
  brand?: string;
  url?: string;
  prices?: TottusPrice[];
  measurements?: { format?: string; unit?: string };
  mediaUrls?: string[];
  multipurposeBadges?: Array<{
    label?: string;
    promotionData?: { totalQuantityToBuy?: string };
  }>;
  sellerName?: string;
}

export class TottusAdapter implements StoreAdapter {
  readonly id = "tottus" as const;
  constructor(private readonly http: HttpFetcher = defaultHttpClient) {}

  async searchProducts(query: string, opts: SearchOpts = {}): Promise<Product[]> {
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 48);
    const page = Math.max(opts.page ?? 1, 1);
    const html = await this.fetchSearchHtml(query, page, opts.session);
    const results = extractTottusResults(html);
    return results
      .slice(0, limit)
      .map((p) => this.mapProduct(p))
      .filter((p): p is Product => p !== null);
  }

  /** Usa el puente de navegador de la sesión si está, si no HTTP directo. */
  private async fetchSearchHtml(
    query: string,
    page: number,
    session?: Session
  ): Promise<string> {
    const path = `/tottus-cl/buscar?Ntt=${encodeURIComponent(query)}${page > 1 ? `&page=${page}&store=to_com` : ""}`;
    if (session?.fetchAuthedHtml) return session.fetchAuthedHtml(path);
    return this.http.getText(`${BASE}${path}`);
  }

  /** Público para el test de contrato con la fixture. */
  mapProduct(p: TottusProduct): Product | null {
    if (!p.displayName || !(p.skuId || p.productId)) return null;

    const internet = p.prices?.find((x) => x.type === "internetPrice");
    const normal = p.prices?.find((x) => x.type === "normalPrice" || x.crossed);
    const price =
      parseClpString(internet?.price?.[0]) ?? parseClpString(p.prices?.[0]?.price?.[0]);
    if (price === undefined) return null;

    let listPrice = parseClpString(normal?.price?.[0]);
    if (listPrice !== undefined && listPrice <= price) listPrice = undefined;

    // precio por unidad desde el pum del internetPrice
    const pumPrice = parseClpString(internet?.pum?.price?.[0]);
    const pumUnit = internet?.pum?.label
      ? normalizeUnit(internet.pum.label)
      : undefined;

    // Bundles: multipurposeBadges ("2 X $2000") + totalQuantityToBuy.
    const promotions = (p.multipurposeBadges ?? [])
      .filter((b) => b.label)
      .map((b) => {
        const parsed = parseBundle(b.label);
        if (!parsed) return undefined;
        const qty = b.promotionData?.totalQuantityToBuy
          ? Number(b.promotionData.totalQuantityToBuy)
          : parsed.minQuantity;
        return {
          ...parsed,
          ...(qty && Number.isFinite(qty) ? { minQuantity: qty } : {}),
          ...(qty && parsed.bundlePrice
            ? { unitPriceInBundle: Math.round(parsed.bundlePrice / qty) }
            : {}),
        };
      })
      .filter(
        (b): b is NonNullable<typeof b> => b !== undefined && b.type === "bundle"
      );

    return {
      store: this.id,
      id: String(p.skuId ?? p.productId),
      sku: p.productId ? String(p.productId) : undefined,
      name: p.displayName,
      brand: p.brand || undefined,
      price,
      ...(listPrice !== undefined ? { listPrice } : {}),
      ...(pumPrice !== undefined ? { unitPrice: pumPrice } : {}),
      ...(pumUnit ? { unit: pumUnit } : {}),
      ...(p.measurements?.format ? { description: p.measurements.format } : {}),
      ...(promotions.length > 0 ? { promotions } : {}),
      ...(listPrice !== undefined ? { offer: { type: "descuento" } } : {}),
      inStock: true,
      ...(p.mediaUrls?.[0] ? { imageUrl: p.mediaUrls[0] } : {}),
      ...(p.url ? { url: p.url } : {}),
      fetchedAt: new Date().toISOString(),
    };
  }

  async getProduct(): Promise<Product | null> {
    throw new NotImplementedError(this.id, "getProduct", "fase 5 (siguiente)");
  }
  async getOffers(_opts?: OfferOpts): Promise<Product[]> {
    throw new NotImplementedError(this.id, "getOffers", "fase 5 (siguiente)");
  }
  async getFrequentPurchases(_s: Session): Promise<Product[]> {
    throw new NotImplementedError(this.id, "getFrequentPurchases", "fase futura");
  }
  async getSavedLists(_s: Session): Promise<ShoppingList[]> {
    throw new NotImplementedError(this.id, "getSavedLists", "fase futura");
  }
  async getMemberPrice(_id: string, _s: Session): Promise<Price> {
    throw new NotImplementedError(this.id, "getMemberPrice", "fase futura");
  }
  async addToCart(_i: CartItem[], _s: Session): Promise<Cart> {
    throw new NotImplementedError(this.id, "addToCart", "fase futura");
  }
  async getCart(_s: Session): Promise<Cart> {
    throw new NotImplementedError(this.id, "getCart", "fase futura");
  }
}

/** Extrae props.pageProps.results del __NEXT_DATA__ del HTML SSR. */
export function extractTottusResults(html: string): TottusProduct[] {
  const start = html.indexOf(NEXT_DATA_MARKER);
  if (start === -1) return [];
  const from = start + NEXT_DATA_MARKER.length;
  const end = html.indexOf("</script>", from);
  if (end === -1) return [];
  try {
    const data = JSON.parse(html.slice(from, end));
    const results = data?.props?.pageProps?.results;
    return Array.isArray(results) ? results : [];
  } catch {
    return [];
  }
}

/**
 * Normaliza lo que entrega el navegador para el puente de búsqueda de Tottus.
 * Acepta el HTML completo de la página (con `<script id="__NEXT_DATA__">`) o
 * solo el JSON de `__NEXT_DATA__`, y devuelve siempre HTML parseable por
 * `extractTottusResults`. Es el fallback cuando el 403 antibot bloquea el fetch
 * directo del servidor: el usuario abre la búsqueda en su navegador real (que
 * sí pasa) y nos pasa ese contenido.
 */
export function wrapTottusHtml(browserContent: string): string {
  const s = browserContent.trim();
  if (s.includes('id="__NEXT_DATA__"')) return s;
  return `${NEXT_DATA_MARKER}${s}</script>`;
}
