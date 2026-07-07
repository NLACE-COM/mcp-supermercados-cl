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
 * Adaptador Unimarc (VTEX, BFF propio). Verificado 2026-07-07 desde IP
 * residencial (bloquea datacenter con 403):
 *
 *   POST https://bff-unimarc-ecommerce.unimarc.cl/catalog/product/search
 *   body: {from, to, searching, promotionsOnly:false, orderBy:"", userTriggered:true}
 *
 * Respuesta: `availableProducts[]` con {price, item, priceDetail}.
 *  - price.price: vigente (string "$"). price.listPrice: normal.
 *  - price.ppum: precio por unidad ("$2.500 x litro").
 *  - priceDetail.promotionalTag.text "Club Unimarc": marca precio socio.
 */

const BFF = "https://bff-unimarc-ecommerce.unimarc.cl";
const SITE = "https://www.unimarc.cl";

interface UnimarcProduct {
  price?: {
    price?: string;
    listPrice?: string;
    priceWithoutDiscount?: string;
    inOffer?: boolean;
    ppum?: string;
  };
  item?: {
    sku?: string;
    name?: string;
    brand?: string;
    slug?: string;
    ean?: string;
    description?: string;
    images?: string[];
  };
  priceDetail?: {
    promotionalTag?: { text?: string } | null;
  };
}

interface UnimarcSearchResponse {
  availableProducts?: UnimarcProduct[];
}

export class UnimarcAdapter implements StoreAdapter {
  readonly id = "unimarc" as const;
  constructor(private readonly http: HttpFetcher = defaultHttpClient) {}

  async searchProducts(query: string, opts: SearchOpts = {}): Promise<Product[]> {
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 49);
    const page = Math.max(opts.page ?? 1, 1);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const json = await this.http.postJson<UnimarcSearchResponse>(
      `${BFF}/catalog/product/search`,
      {
        from: String(from),
        to: String(to),
        searching: query,
        promotionsOnly: false,
        orderBy: "",
        userTriggered: true,
      },
      // Headers que exige el BFF (verificado 2026-07-07): sin ellos responde
      // 422. `session`/`anonymous` los genera el cliente; estos fijos bastan.
      {
        headers: {
          channel: "UNIMARC",
          source: "web",
          version: "1.0.0",
        },
      }
    );
    const products = json.availableProducts ?? [];
    return products
      .map((p) => this.mapProduct(p))
      .filter((p): p is Product => p !== null);
  }

  /** Público para el test de contrato con la fixture. */
  mapProduct(p: UnimarcProduct): Product | null {
    const item = p.item;
    const priceInfo = p.price;
    if (!item?.name || !item.sku || !priceInfo) return null;

    const price = parseClpString(priceInfo.price);
    if (price === undefined) return null;
    let listPrice = parseClpString(priceInfo.listPrice);
    if (listPrice !== undefined && listPrice <= price) listPrice = undefined;

    const ppu = parseUnitPriceString(priceInfo.ppum);
    const tag = p.priceDetail?.promotionalTag?.text;
    const isClub = typeof tag === "string" && /club/i.test(tag);

    const offer = isClub
      ? { type: "club", clubOnly: true, description: tag }
      : listPrice !== undefined
        ? { type: "descuento" }
        : undefined;

    // El precio "Club Unimarc" ya viene aplicado en price cuando el tag es
    // Club; lo exponemos también como memberPrice para consistencia.
    const memberPrice = isClub ? price : undefined;

    const url = item.slug
      ? `${SITE}/product${item.slug}`
      : undefined;

    return {
      store: this.id,
      id: item.sku,
      sku: item.sku,
      ean: item.ean || undefined,
      name: item.name,
      brand: item.brand || undefined,
      price,
      ...(listPrice !== undefined ? { listPrice } : {}),
      ...(memberPrice !== undefined ? { memberPrice } : {}),
      ...(ppu ? { unitPrice: ppu.unitPrice, unit: ppu.unit } : {}),
      ...(item.description && item.description !== item.name
        ? { description: item.description }
        : {}),
      ...(offer ? { offer } : {}),
      inStock: true,
      ...(item.images?.[0] ? { imageUrl: item.images[0] } : {}),
      ...(url ? { url } : {}),
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
