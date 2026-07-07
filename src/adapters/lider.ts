import { parseClpString, parseUnitPriceString } from "../core/normalize.js";
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
 * Adaptador Lider (Walmart Chile, plataforma Glass). Verificado 2026-07-07
 * desde IP residencial: pese a PerimeterX, la búsqueda SSR entrega los datos
 * sin necesitar el GraphQL ni Playwright:
 *
 *   GET https://super.lider.cl/search?query={query}
 *
 * El HTML trae `__NEXT_DATA__` con nodos `__typename: "Product"`. `priceInfo`:
 *  - linePrice: precio vigente. wasPrice: precio normal (tachado).
 *  - unitPrice: precio por unidad ("$1.190 x kg").
 *  - memberPriceString: precio socio cuando aplica.
 *
 * Nota: desde datacenter PerimeterX bloquea; en la máquina del usuario (IP
 * residencial, como corre el MCP) responde. Si un día bloquea, el fallback
 * es un puente de navegador (session.fetchAuthedHtml).
 */

const BASE = "https://super.lider.cl";

interface LiderPriceInfo {
  itemPrice?: string;
  linePrice?: string;
  wasPrice?: string;
  unitPrice?: string;
  memberPriceString?: string;
}

interface LiderProduct {
  __typename?: string;
  usItemId?: string;
  id?: string;
  name?: string;
  brand?: string;
  canonicalUrl?: string;
  availabilityStatus?: string;
  priceInfo?: LiderPriceInfo;
}

export class LiderAdapter implements StoreAdapter {
  readonly id = "lider" as const;
  constructor(private readonly http: HttpFetcher = defaultHttpClient) {}

  async searchProducts(query: string, opts: SearchOpts = {}): Promise<Product[]> {
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 46);
    const page = Math.max(opts.page ?? 1, 1);
    const html = await this.fetchSearchHtml(query, page, opts.session);
    const products = extractLiderProducts(html);
    return products
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
    const path = `/search?query=${encodeURIComponent(query)}${page > 1 ? `&page=${page}` : ""}`;
    if (session?.fetchAuthedHtml) return session.fetchAuthedHtml(path);
    return this.http.getText(`${BASE}${path}`);
  }

  /** Público para el test de contrato con la fixture. */
  mapProduct(p: LiderProduct): Product | null {
    const id = p.usItemId ?? p.id;
    if (!id || !p.name || !p.priceInfo) return null;

    const info = p.priceInfo;
    const price = parseClpString(info.linePrice) ?? parseClpString(info.itemPrice);
    if (price === undefined) return null;
    let listPrice = parseClpString(info.wasPrice);
    if (listPrice !== undefined && listPrice <= price) listPrice = undefined;

    const memberPrice = parseClpString(info.memberPriceString);
    const ppu = parseUnitPriceString(info.unitPrice);

    return {
      store: this.id,
      id,
      name: p.name,
      brand: p.brand || undefined,
      price,
      ...(listPrice !== undefined ? { listPrice } : {}),
      ...(memberPrice !== undefined ? { memberPrice } : {}),
      ...(ppu ? { unitPrice: ppu.unitPrice, unit: ppu.unit } : {}),
      ...(listPrice !== undefined ? { offer: { type: "descuento" } } : {}),
      inStock: p.availabilityStatus ? p.availabilityStatus === "IN_STOCK" : true,
      ...(p.canonicalUrl ? { url: `${BASE}${p.canonicalUrl}` } : {}),
      fetchedAt: new Date().toISOString(),
    };
  }

  async getProduct(): Promise<Product | null> {
    throw new NotImplementedError(this.id, "getProduct", "fase 6 (siguiente)");
  }
  async getOffers(_opts?: OfferOpts): Promise<Product[]> {
    throw new NotImplementedError(this.id, "getOffers", "fase 6 (siguiente)");
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

/**
 * Extrae los nodos con __typename "Product" del __NEXT_DATA__ del HTML SSR.
 * El árbol de Glass es profundo; se recorre buscando el arreglo de productos.
 */
export function extractLiderProducts(html: string): LiderProduct[] {
  const marker = '<script id="__NEXT_DATA__" type="application/json">';
  const start = html.indexOf(marker);
  if (start === -1) return [];
  const from = start + marker.length;
  const end = html.indexOf("</script>", from);
  if (end === -1) return [];
  let data: unknown;
  try {
    data = JSON.parse(html.slice(from, end));
  } catch {
    return [];
  }
  const found = findProductArray(data, 0);
  return found ?? [];
}

function findProductArray(node: unknown, depth: number): LiderProduct[] | null {
  if (depth > 12 || node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    if (
      node.length > 0 &&
      node[0] &&
      typeof node[0] === "object" &&
      (node[0] as LiderProduct).__typename === "Product"
    ) {
      return node as LiderProduct[];
    }
    for (const child of node) {
      const r = findProductArray(child, depth + 1);
      if (r) return r;
    }
    return null;
  }
  for (const key of Object.keys(node as Record<string, unknown>)) {
    const r = findProductArray((node as Record<string, unknown>)[key], depth + 1);
    if (r) return r;
  }
  return null;
}
