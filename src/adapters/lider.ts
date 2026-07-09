import {
  parseBundle,
  parseClpString,
  parseUnitPriceString,
} from "../core/normalize.js";
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
 * Adaptador Lider (Walmart Chile, plataforma Glass). La búsqueda vive en el SSR:
 *
 *   GET https://super.lider.cl/search?query={query}
 *
 * El HTML trae `__NEXT_DATA__` con nodos `__typename: "Product"`. `priceInfo`:
 *  - linePrice: precio vigente. wasPrice: precio normal (tachado).
 *  - unitPrice: precio por unidad ("$1.190 x kg").
 *  - memberPriceString: precio socio cuando aplica.
 *
 * Bloqueo (issue #2, verificado 2026-07-08): el sitio bloquea CUALQUIER cliente
 * HTTP plano —incluso desde IP residencial— por fingerprint del cliente (TLS/JA3
 * + desafío JS de PerimeterX, con F5 BIG-IP delante: cookie `TS...`). Responde
 * `307 → /blocked` (no 403), sin `__NEXT_DATA__`. Headers Chrome completos +
 * HTTP/2 no lo evitan; la MISMA IP en un navegador real sí carga los datos.
 * (La nota anterior —"desde IP residencial responde"— quedó obsoleta.)
 *
 * Fallback operativo: puente de navegador (`session.fetchAuthedHtml`). El usuario
 * abre la búsqueda en su navegador real (que ya pasó el antibot) y pasa el
 * contenido; `search_products` lo acepta vía `browserHtml`. Ojo: leer del DOM
 * (`document.getElementById('__NEXT_DATA__')`), no un fetch same-origin —el App
 * Router devuelve streaming (`self.__next_f`) sin el `<script id="__NEXT_DATA__">`.
 */

const BASE = "https://super.lider.cl";
const NEXT_DATA_MARKER = '<script id="__NEXT_DATA__" type="application/json">';

/**
 * PerimeterX no siempre responde 403: a veces redirige (307) a /blocked, una
 * página "Robot or human?" sin `__NEXT_DATA__`. Sin esta detección eso se
 * confundía con "0 resultados", que suena a "no venden el producto".
 */
export function isLiderBlockedHtml(html: string): boolean {
  return html.includes("Robot or human") || !html.includes(NEXT_DATA_MARKER);
}

/**
 * Normaliza lo que entrega el navegador para el puente de búsqueda de Líder.
 * Acepta el HTML completo de la página (con `<script id="__NEXT_DATA__">`) o
 * solo el JSON de `__NEXT_DATA__`, y devuelve siempre HTML parseable por
 * `extractLiderProducts`. Es el fallback cuando PerimeterX bloquea el fetch
 * directo del servidor: el usuario abre la búsqueda en su navegador real (que
 * sí pasa el antibot) y nos pasa ese contenido.
 */
export function wrapLiderHtml(browserContent: string): string {
  const s = browserContent.trim();
  if (s.includes('id="__NEXT_DATA__"')) return s;
  return `${NEXT_DATA_MARKER}${s}</script>`;
}

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
  shortDescription?: string;
  imageInfo?: {
    thumbnailUrl?: string;
    allImages?: Array<{ url?: string }>;
  };
  badges?: {
    flags?: Array<{ key?: string; text?: string; type?: string }>;
  };
}

export class LiderAdapter implements StoreAdapter {
  readonly id = "lider" as const;
  constructor(private readonly http: HttpFetcher = defaultHttpClient) {}

  async searchProducts(query: string, opts: SearchOpts = {}): Promise<Product[]> {
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 46);
    const page = Math.max(opts.page ?? 1, 1);
    const html = await this.fetchSearchHtml(query, page, opts.session);
    if (isLiderBlockedHtml(html)) {
      throw new Error(
        'Líder bloqueó la petición: su antibot (PerimeterX + F5 BIG-IP, 307 → /blocked, "Robot or human") ' +
          "respondió en vez de los resultados. Es fingerprint del cliente, no tu IP: abre la búsqueda en un " +
          "navegador real y reintenta pasando browserHtml a search_products."
      );
    }
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

    // Bundles: badges.flags con promo multi-compra ("Combina 2 x $4.890").
    // Se excluyen los flags que son solo etiqueta de oferta (ROLLBACK/Rebaja).
    const promotions = (p.badges?.flags ?? [])
      .filter((f) => f.text && f.type !== "ICON")
      .map((f) => parseBundle(f.text))
      .filter(
        (b): b is NonNullable<typeof b> => b !== undefined && b.type === "bundle"
      );

    return {
      store: this.id,
      id,
      name: p.name,
      brand: p.brand || undefined,
      price,
      ...(listPrice !== undefined ? { listPrice } : {}),
      ...(memberPrice !== undefined ? { memberPrice } : {}),
      ...(ppu ? { unitPrice: ppu.unitPrice, unit: ppu.unit } : {}),
      ...(p.shortDescription ? { description: p.shortDescription } : {}),
      ...(promotions.length > 0 ? { promotions } : {}),
      ...(listPrice !== undefined ? { offer: { type: "descuento" } } : {}),
      inStock: p.availabilityStatus ? p.availabilityStatus === "IN_STOCK" : true,
      ...(imageUrl(p) ? { imageUrl: imageUrl(p) } : {}),
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

/** Mejor URL de imagen de un producto de Lider. */
function imageUrl(p: LiderProduct): string | undefined {
  return p.imageInfo?.thumbnailUrl || p.imageInfo?.allImages?.[0]?.url || undefined;
}

/**
 * Extrae los nodos con __typename "Product" del __NEXT_DATA__ del HTML SSR.
 * El árbol de Glass es profundo; se recorre buscando el arreglo de productos.
 */
export function extractLiderProducts(html: string): LiderProduct[] {
  const start = html.indexOf(NEXT_DATA_MARKER);
  if (start === -1) return [];
  const from = start + NEXT_DATA_MARKER.length;
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
