import { randomUUID } from "node:crypto";
import { TtlCache } from "../core/cache.js";
import {
  computeUnitPrice,
  normalizeText,
  normalizeUnit,
  normalizeUnitPrice,
  toClp,
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
  StoreId,
} from "../core/types.js";
import { defaultHttpClient, type HttpFetcher } from "../http/client.js";
import { NotImplementedError, type StoreAdapter } from "./base.js";
import {
  extractFrequentCardsFromHtml,
  parseFrequentCard,
} from "./cencosudSession.js";
import { parseCart } from "./cencosudCart.js";
import { parseShoppingLists } from "./cencosudLists.js";

/**
 * Adaptador Cencosud (Jumbo + Santa Isabel).
 *
 * Búsqueda: Constructor.io. Request capturado del tráfico real el 2026-07-06
 * (ver docs/captura-cencosud-2026-07-06.md):
 *
 *   GET https://pwcdauseo-zone.cnstrc.com/search/{query}
 *     ?key=key_JopvNXKS61kwGkBe   (prod jumboCL, embebida en el frontend)
 *     &i={uuid cliente} &s={n sesión} &c=ciojs-2.1436.4
 *     &page=N &num_results_per_page=N
 *     &variations_map={...}       (precios/stock por sucursal, ver abajo)
 *
 * Sin cookies ni headers especiales; basta un user-agent realista.
 *
 * Detalle de producto: la página /slug/p es SSR y embebe un estado
 * deshidratado de React Query con el producto completo, incluyendo las
 * promociones con userProperties "PRIME_USER" (precio socio, visible sin
 * login). El API sm-web-api de detalle exige key (401) — pendiente fase 2.
 */

export interface CencosudBannerConfig {
  storeId: StoreId;
  /** Host de zona de Constructor.io */
  constructorHost: string;
  /** Key pública del índice Constructor (embebida en el frontend del sitio) */
  constructorKey: string;
  /** Base del sitio, para URLs de producto y fetch de PDP */
  siteBaseUrl: string;
  /**
   * Capacidades verificadas por banner. Distintos banners Cencosud comparten
   * el backend de búsqueda (Constructor) pero difieren en frontend (Jumbo:
   * React Query; Santa Isabel: VTEX renderData con comuna), así que no todos
   * soportan lo mismo aún.
   */
  offersCollectionId?: string;
  primeOffersCollectionId?: string;
  /**
   * Estilo de PDP para getProduct/memberPrice.
   * - "react-query": estado deshidratado del HTML SSR (Jumbo).
   * - "bff-pdp": POST a un BFF con {slug, store} que devuelve el producto
   *   directo (Santa Isabel). Requiere `bffPdpUrl` y `defaultStore`.
   */
  pdpStyle: "react-query" | "bff-pdp";
  /** URL del BFF de detalle (pdpStyle "bff-pdp"). */
  bffPdpUrl?: string;
  /** Sucursal por defecto para el detalle si no se pasa branchId. */
  defaultStore?: string;
  /** Headers que exige el BFF de detalle (apiKey pública, versión de cliente). */
  bffHeaders?: Record<string, string>;
}

export const JUMBO_CONFIG: CencosudBannerConfig = {
  storeId: "jumbo",
  constructorHost: "pwcdauseo-zone.cnstrc.com",
  // Clave PÚBLICA de Constructor.io (autocompletado del lado cliente): va
  // embebida en el JS de www.jumbo.cl y es visible en DevTools de cualquier
  // visitante. NO es un secreto: identifica el índice de búsqueda, no da
  // acceso a cuentas ni permite escribir. Sin ella el buscador no responde.
  constructorKey: "key_JopvNXKS61kwGkBe",
  siteBaseUrl: "https://www.jumbo.cl",
  // Colecciones verificadas 2026-07-06: /jumbo-ofertas y /ofertas-prime.
  offersCollectionId: "30399",
  primeOffersCollectionId: "30307",
  pdpStyle: "react-query",
};

/**
 * Santa Isabel comparte el backend de BÚSQUEDA (Constructor). Verificado
 * 2026-07-07: su key responde en el host estándar `ac.cnstrc.com` con la
 * misma forma de payload (SkuData, sellingPrice, ofertas reales). La
 * búsqueda es "casi gratis" reutilizando este adaptador.
 *
 * Diferencias (por eso solo search está habilitado):
 * - PDP: usa `window.__renderData` (VTEX) y redirige a página vacía + exige
 *   "Elige tu modo de entrega" (comuna). Precios en 0 sin comuna =>
 *   getProduct/memberPrice por HTTP directo no aplican (pdpStyle
 *   "requires-locale").
 * - Ofertas: su página /santas-ofertas es VTEX (fq=H:categoría), no las
 *   colecciones Constructor de Jumbo. Sin offersCollectionId por ahora.
 * - Las URLs de producto de Constructor apuntan a www.sisa.cl.
 */
export const SANTA_ISABEL_CONFIG: CencosudBannerConfig = {
  storeId: "santaisabel",
  constructorHost: "ac.cnstrc.com",
  // Clave PÚBLICA de Constructor.io, igual que la de Jumbo: embebida en el
  // frontend de www.santaisabel.cl, no es un secreto.
  constructorKey: "key_c73M3GMIWJ8AcNnd",
  siteBaseUrl: "https://www.santaisabel.cl",
  // Detalle vía BFF propio (verificado 2026-07-07): POST /catalog/pdp con
  // {slug, store}. Misma forma de item que Jumbo (price/listPrice/promotions).
  pdpStyle: "bff-pdp",
  bffPdpUrl: "https://bff.santaisabel.cl/catalog/pdp",
  defaultStore: "pedrofontova",
  // apiKey pública embebida en el frontend de santaisabel.cl (verificada
  // 2026-07-07). x-trace-id es un uuid cualquiera por request.
  bffHeaders: {
    apiKey: "be-reg-groceries-sisa-catalog-wdhhq5a2fken",
    "x-client-platform": "web",
    "x-client-version": "2.3.17",
  },
};

/** Versión del cliente ciojs observada en producción (param `c`). */
const CIO_CLIENT_VERSION = "ciojs-2.1436.4";

// --- Tipos mínimos de la respuesta de Constructor.io (solo lo que usamos) ---

interface ConstructorSearchResponse {
  response?: {
    results?: ConstructorResult[];
    total_num_results?: number;
    groups?: ConstructorGroup[];
  };
}

interface ConstructorGroup {
  group_id?: string;
  display_name?: string;
  children?: ConstructorGroup[];
}

interface ConstructorResult {
  value?: string;
  data?: Record<string, unknown>;
  variations_map?: Array<Record<string, unknown>>;
}

/** Contenido relevante del string JSON `SkuData` de cada resultado. */
interface CencosudSkuData {
  measurement_unit_un?: string;
  unit_multiplier_un?: number;
  promotionData?: {
    promotionName?: string;
    promotionShortDescription?: string;
    promotionDescription?: string;
  };
}

export class CencosudAdapter implements StoreAdapter {
  readonly id: StoreId;
  private readonly config: CencosudBannerConfig;
  private readonly http: HttpFetcher;
  /** UUID persistente por proceso, análogo al cookie `i` de ciojs. */
  private readonly clientId: string;
  /** Cache 15 min por consulta (regla del plan) para no regolpear el sitio. */
  private readonly cache = new TtlCache<Product[]>();
  private readonly productCache = new TtlCache<Product | null>();

  constructor(
    config: CencosudBannerConfig = JUMBO_CONFIG,
    http: HttpFetcher = defaultHttpClient,
    clientId: string = randomUUID()
  ) {
    this.config = config;
    this.id = config.storeId;
    this.http = http;
    this.clientId = clientId;
  }

  // ------------------------------------------------------------------
  // Búsqueda pública (Constructor.io)
  // ------------------------------------------------------------------

  async searchProducts(query: string, opts: SearchOpts = {}): Promise<Product[]> {
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
    const page = Math.max(opts.page ?? 1, 1);
    const cacheKey = `search:${query}:${limit}:${page}:${opts.branchId ?? ""}`;
    return this.cache.getOrFetch(cacheKey, () =>
      this.fetchSearch(query, { limit, page, branchId: opts.branchId })
    );
  }

  private async fetchSearch(
    query: string,
    opts: { limit: number; page: number; branchId?: string }
  ): Promise<Product[]> {
    const { limit, page } = opts;
    const params = new URLSearchParams({
      key: this.config.constructorKey,
      i: this.clientId,
      s: "1",
      c: CIO_CLIENT_VERSION,
      page: String(page),
      num_results_per_page: String(limit),
      _dt: String(Date.now()),
    });
    if (opts.branchId) {
      params.set(
        "variations_map",
        JSON.stringify(buildVariationsMap(opts.branchId))
      );
    }

    const url = `https://${this.config.constructorHost}/search/${encodeURIComponent(
      query
    )}?${params.toString()}`;

    const json = await this.http.getJson<ConstructorSearchResponse>(url);
    const results = json.response?.results ?? [];
    return results
      .map((r) => this.mapSearchResult(r, opts.branchId))
      .filter((p): p is Product => p !== null);
  }

  /**
   * Mapea un resultado crudo de Constructor al esquema normalizado.
   * Público para poder testearlo por contrato con fixtures grabadas.
   */
  mapSearchResult(result: ConstructorResult, branchId?: string): Product | null {
    const data = result.data;
    const name = result.value ?? (data?.ProductName as string | undefined);
    if (!data || !name || typeof data.id !== "string") return null;

    // Precio nacional por defecto: sellingPrice es el vigente (con oferta),
    // price/listPrice el normal.
    let price = toClp(data.sellingPrice) ?? toClp(data.price);
    let listPrice = toClp(data.listPrice) ?? toClp(data.originalPrice);
    let inStock =
      data.stockLevel !== undefined
        ? data.stockLevel === "in-stock"
        : data.outOfStock !== true;

    // Con sucursal: el filtro por data.storeId del variations_map devuelve
    // los valores agregados de esa tienda. Si la tienda no tiene el
    // producto, el arreglo viene vacío => sin stock local.
    if (branchId) {
      const variation = result.variations_map?.[0];
      if (variation) {
        price = toClp(variation.sellingPrice) ?? toClp(variation.price) ?? price;
        listPrice = toClp(variation.listPrice) ?? listPrice;
        inStock = variation.stockLevel === "in-stock";
      } else {
        inStock = false;
      }
    }

    if (price === undefined) return null;
    // listPrice solo interesa si hay descuento real.
    if (listPrice !== undefined && listPrice <= price) listPrice = undefined;

    const sku = parseSkuData(data);
    const unit = sku?.measurement_unit_un
      ? normalizeUnit(sku.measurement_unit_un)
      : undefined;
    const unitPrice = computeUnitPrice(price, sku?.unit_multiplier_un);

    const promoName = sku?.promotionData?.promotionName || undefined;
    const offer =
      listPrice !== undefined
        ? {
            type: "descuento",
            ...(promoName ? { description: promoName } : {}),
          }
        : undefined;

    const rawUrl = data.url as string | undefined;
    const detailUrl = data.DetailUrl as string | undefined;
    const url =
      rawUrl ?? (detailUrl ? `${this.config.siteBaseUrl}${detailUrl}` : undefined);

    return {
      store: this.id,
      id: data.id,
      sku: (data.ProductRefId as string | undefined) ?? undefined,
      name,
      brand: (data.BrandName as string | undefined) || undefined,
      price,
      ...(listPrice !== undefined ? { listPrice } : {}),
      ...(unitPrice !== undefined ? { unitPrice } : {}),
      ...(unit ? { unit } : {}),
      ...(offer ? { offer } : {}),
      inStock,
      imageUrl: (data.image_url as string | undefined) || undefined,
      ...(url ? { url } : {}),
      fetchedAt: new Date().toISOString(),
    };
  }

  // ------------------------------------------------------------------
  // Detalle de producto (SSR de la PDP, incluye precio Prime)
  // ------------------------------------------------------------------

  async getProduct(idOrUrl: string, session?: Session): Promise<Product | null> {
    const url = this.resolveProductUrl(idOrUrl);
    if (!url) return null;

    if (this.config.pdpStyle === "bff-pdp") {
      const slug = this.slugFromUrl(url);
      const store = session?.branchId ?? this.config.defaultStore ?? "";
      return this.productCache.getOrFetch(`pdp:${slug}:${store}`, async () => {
        const data = await this.http.postJson<any>(
          this.config.bffPdpUrl!,
          { slug, store },
          {
            headers: {
              ...this.config.bffHeaders,
              "x-trace-id": randomUUID(),
            },
          }
        );
        return this.mapPdpData(data, url);
      });
    }

    return this.productCache.getOrFetch(`pdp:${url}`, async () => {
      const html = await this.http.getText(url);
      const state = extractDehydratedState(html);
      if (!state) return null;
      return this.mapPdpState(state, url);
    });
  }

  /** Slug pelado desde una URL/path de producto (…/{slug}/p). */
  private slugFromUrl(url: string): string {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const m = path.match(/\/([^/]+)\/p\/?$/);
    return m ? m[1] : path.replace(/^\//, "").replace(/\/p\/?$/, "");
  }

  /** Acepta URL completa, path (/slug/p) o slug pelado. */
  private resolveProductUrl(idOrUrl: string): string | null {
    if (/^https?:\/\//.test(idOrUrl)) return idOrUrl;
    if (idOrUrl.startsWith("/")) return `${this.config.siteBaseUrl}${idOrUrl}`;
    if (idOrUrl.trim().length === 0) return null;
    const slug = idOrUrl.replace(/\/p$/, "");
    return `${this.config.siteBaseUrl}/${slug}/p`;
  }

  /**
   * Mapea el estado deshidratado de React Query de la PDP. Público para
   * el test de contrato con la fixture HTML grabada.
   */
  mapPdpState(state: unknown, url: string): Product | null {
    const queries = (state as { queries?: Array<Record<string, any>> })?.queries;
    if (!Array.isArray(queries)) return null;
    const pdpQuery = queries.find(
      (q) => Array.isArray(q?.queryKey) && q.queryKey[0] === "pdp"
    );
    const data = pdpQuery?.state?.data;
    if (!data) return null;
    return this.mapPdpData(data, url);
  }

  /**
   * Mapea el objeto de producto de la PDP `{productId, brand, items[]}` a
   * Product. Lo comparten el estado deshidratado de Jumbo (react-query) y la
   * respuesta directa del BFF de Santa Isabel (POST /catalog/pdp). Público
   * para el test de contrato.
   */
  mapPdpData(data: any, url: string): Product | null {
    const item = data?.items?.[0];
    if (!data || !item) return null;

    const price = toClp(item.price);
    if (price === undefined) return null;
    let listPrice = toClp(item.listPrice);
    if (listPrice !== undefined && listPrice <= price) listPrice = undefined;

    // Las promociones traen el precio socio: userProperties "PRIME_USER".
    const promotions: Array<Record<string, any>> = Array.isArray(item.promotions)
      ? item.promotions
      : [];
    const primePromo = promotions.find(
      (p) => p?.userProperties === "PRIME_USER"
    );
    const memberPrice = primePromo ? toClp(primePromo.unitPrice) : undefined;

    const pillName: string | undefined = data?.pill?.name || item?.pill?.name;
    const publicPromo = promotions.find((p) => p?.userProperties === "ALL");
    const offer =
      listPrice !== undefined || publicPromo
        ? {
            type: pillName?.toLowerCase() === "oferta" ? "descuento" : (pillName ?? "descuento"),
            ...(publicPromo?.description
              ? { description: publicPromo.description as string }
              : {}),
          }
        : undefined;

    // Precio por unidad normalizado a base canónica (por kg/lt), por si la
    // ficha lo entrega en g/ml.
    const rawPpum = toClp(item.ppumPrice);
    const rawPpumUnit = item.ppumMeasurementUnit as string | undefined;
    let unit: string | undefined;
    let unitPrice: number | undefined;
    if (rawPpum !== undefined && rawPpumUnit) {
      const norm = normalizeUnitPrice(rawPpum, 1, rawPpumUnit);
      unitPrice = norm.unitPrice;
      unit = norm.unit;
    } else {
      unit = item.measurementUnitUn
        ? normalizeUnit(item.measurementUnitUn)
        : undefined;
      unitPrice = computeUnitPrice(
        price,
        item.unitMultiplierUn as number | undefined
      );
    }

    // Bundles: promociones con mQuantity > 1 ("Lleva N por $X"). El precio
    // total del pack es unitPrice * mQuantity. Excluimos las de socio (esas
    // van como memberPrice) y las de 1 unidad (oferta simple).
    const bundlePromos = promotions
      .filter(
        (p) =>
          typeof p?.mQuantity === "number" &&
          p.mQuantity > 1 &&
          p.userProperties !== "PRIME_USER"
      )
      .map((p) => {
        const minQuantity = p.mQuantity as number;
        const unitInBundle = toClp(p.unitPrice);
        return {
          description:
            (p.description as string) ||
            `Lleva ${minQuantity}${unitInBundle ? ` por $${(unitInBundle * minQuantity).toLocaleString("es-CL")}` : ""}`,
          type: "bundle",
          minQuantity,
          ...(unitInBundle !== undefined
            ? {
                bundlePrice: unitInBundle * minQuantity,
                unitPriceInBundle: unitInBundle,
              }
            : {}),
        };
      });

    return {
      store: this.id,
      id: String(data.productId ?? item.skuId),
      sku: item.skuId ? String(item.skuId) : undefined,
      ean: item.ean ? String(item.ean) : undefined,
      name: String(item.name ?? data.metaTagTitle ?? ""),
      brand: (data.brand as string | undefined) || undefined,
      price,
      ...(listPrice !== undefined ? { listPrice } : {}),
      ...(memberPrice !== undefined ? { memberPrice } : {}),
      ...(unitPrice !== undefined ? { unitPrice } : {}),
      ...(unit ? { unit } : {}),
      ...(cencosudDescription(data) ? { description: cencosudDescription(data) } : {}),
      ...(cencosudIngredients(data).length > 0
        ? { ingredients: cencosudIngredients(data) }
        : {}),
      ...(Array.isArray(data.nutritionalFlags) && data.nutritionalFlags.length > 0
        ? { nutritionalFlags: data.nutritionalFlags.map(String) }
        : {}),
      ...(offer ? { offer } : {}),
      ...(bundlePromos.length > 0 ? { promotions: bundlePromos } : {}),
      inStock: item.stock === true,
      imageUrl: (item.images?.[0] as string | undefined) || undefined,
      url,
      fetchedAt: new Date().toISOString(),
    };
  }

  // ------------------------------------------------------------------
  // Pendientes de fase 1 tardía / fase 2 / fase 3
  // ------------------------------------------------------------------

  /**
   * Ofertas vigentes vía browse de la colección de ofertas. Con
   * `primeOnly` usa la colección de ofertas exclusivas Prime (los montos
   * del precio socio exacto requieren getProduct, que lee la PDP).
   */
  async getOffers(opts: OfferOpts = {}, _session?: Session): Promise<Product[]> {
    const cacheKey = `offers:${opts.category ?? ""}:${opts.limit ?? 20}:${opts.page ?? 1}:${opts.branchId ?? ""}:${opts.primeOnly ?? false}`;
    return this.cache.getOrFetch(cacheKey, () => this.fetchOffers(opts));
  }

  private async fetchOffers(opts: OfferOpts): Promise<Product[]> {
    const collectionId = opts.primeOnly
      ? this.config.primeOffersCollectionId
      : this.config.offersCollectionId;

    if (!collectionId) {
      throw new Error(
        `get_offers${opts.primeOnly ? " (primeOnly)" : ""} no está disponible ` +
          `para ${this.id}: no hay colección de ofertas verificada para este ` +
          `banner. Usar search_products (trae precios y ofertas por producto).`
      );
    }

    let groupId: string | undefined;
    if (opts.category) {
      groupId = await this.resolveCategoryGroupId(collectionId, opts.category);
    }

    const json = await this.http.getJson<ConstructorSearchResponse>(
      this.buildBrowseUrl(collectionId, {
        limit: Math.min(Math.max(opts.limit ?? 20, 1), 50),
        page: Math.max(opts.page ?? 1, 1),
        branchId: opts.branchId,
        groupId,
      })
    );

    const results = json.response?.results ?? [];
    return results
      .map((r) => this.mapSearchResult(r, opts.branchId))
      .filter((p): p is Product => p !== null)
      .map((p) =>
        opts.primeOnly
          ? {
              ...p,
              offer: {
                type: "club",
                clubOnly: true,
                description:
                  p.offer?.description ??
                  "Oferta exclusiva Jumbo Prime (precio socio exacto vía get_product)",
              },
            }
          : p
      );
  }

  private buildBrowseUrl(
    collectionId: string,
    opts: { limit: number; page: number; branchId?: string; groupId?: string }
  ): string {
    const params = new URLSearchParams({
      key: this.config.constructorKey,
      i: this.clientId,
      s: "1",
      c: CIO_CLIENT_VERSION,
      page: String(opts.page),
      num_results_per_page: String(opts.limit),
      _dt: String(Date.now()),
    });
    if (opts.groupId) params.set("filters[group_id]", opts.groupId);
    if (opts.branchId) {
      params.set(
        "variations_map",
        JSON.stringify(buildVariationsMap(opts.branchId))
      );
    }
    return `https://${this.config.constructorHost}/browse/collection_id/${collectionId}?${params.toString()}`;
  }

  /**
   * Resuelve un nombre de categoría ("Despensa") al group_id numérico
   * usando el árbol `groups` que devuelve el propio browse de la colección.
   */
  private async resolveCategoryGroupId(
    collectionId: string,
    category: string
  ): Promise<string> {
    const json = await this.http.getJson<ConstructorSearchResponse>(
      this.buildBrowseUrl(collectionId, { limit: 1, page: 1 })
    );
    const groups = json.response?.groups ?? [];
    const target = normalizeText(category);

    const found = findGroup(groups, (g) =>
      normalizeText(g.display_name ?? "").includes(target)
    );
    if (found?.group_id) return found.group_id;

    const disponibles = groups
      .map((g) => g.display_name)
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `Categoría "${category}" no encontrada en las ofertas. Disponibles: ${disponibles}.`
    );
  }

  /**
   * Productos frecuentes del usuario (fase 2). Requiere sesión: el token
   * vive en el localStorage del navegador, así que la sesión debe traer un
   * puente autenticado (`fetchAuthedHtml`) o las cards ya extraídas
   * (`frequentCards`). Ver adapters/session.ts y docs.
   */
  async getFrequentPurchases(session: Session): Promise<Product[]> {
    const cards = await this.resolveFrequentCards(session);
    return cards
      .map((c) => parseFrequentCard(c, this.id, this.config.siteBaseUrl))
      .filter((p): p is Product => p !== null);
  }

  private async resolveFrequentCards(session: Session) {
    if (session.frequentCards?.length) return session.frequentCards;
    if (session.fetchAuthedHtml) {
      const html = await session.fetchAuthedHtml("/productos-frecuentes?page=1");
      return extractFrequentCardsFromHtml(html);
    }
    throw new Error(
      "getFrequentPurchases requiere una sesión con puente de navegador " +
        "(fetchAuthedHtml) o cards ya extraídas (frequentCards). El token de " +
        "Jumbo vive en localStorage; ver docs/captura-cencosud-2026-07-06.md §sesión."
    );
  }

  /**
   * Listas guardadas del usuario. Requiere sesión: el navegador entrega el
   * JSON crudo de GET /lists (y el detalle con items) en `savedListsRaw`,
   * porque el token vive en su localStorage. El servidor solo normaliza.
   */
  async getSavedLists(session: Session): Promise<ShoppingList[]> {
    if (session.savedListsRaw !== undefined) {
      return parseShoppingLists(session.savedListsRaw, this.id);
    }
    if (session.fetchAuthedHtml) {
      // Fallback: pedir el JSON de listas por el puente HTML si el cliente
      // lo enruta (algunos puentes devuelven texto JSON).
      const text = await session.fetchAuthedHtml("/lists?store=" + (session.branchId ?? ""));
      try {
        return parseShoppingLists(JSON.parse(text), this.id);
      } catch {
        return [];
      }
    }
    throw new Error(
      "getSavedLists requiere una sesión con las listas ya obtenidas por el " +
        "navegador (savedListsRaw). El token de Jumbo vive en localStorage; " +
        "ver docs §sesión."
    );
  }

  /**
   * Precio socio (Prime) de un producto para el usuario logueado. El precio
   * Prime ya es visible sin login en la PDP, así que se obtiene con
   * getProduct y se expone su memberPrice. Con sesión, se devuelve igual;
   * el valor es el precio que paga el socio.
   */
  async getMemberPrice(id: string, _session: Session): Promise<Price> {
    const product = await this.getProduct(id);
    if (!product) {
      throw new Error(`No se encontró el producto "${id}" para precio socio.`);
    }
    return {
      price: product.price,
      ...(product.listPrice !== undefined ? { listPrice: product.listPrice } : {}),
      ...(product.memberPrice !== undefined
        ? { memberPrice: product.memberPrice }
        : {}),
    };
  }

  /**
   * Agrega/actualiza líneas en el carro del usuario (fase 3). Mapea a
   * PATCH /cart/items. Requiere sesión con puente de carro: el navegador
   * del usuario ejecuta la llamada autenticada; el servidor no ve el token.
   */
  async addToCart(items: CartItem[], session: Session): Promise<Cart> {
    const bridge = this.requireCartBridge(session);
    const branchId = this.requireBranch(session);
    const payload = items.map((i) => ({
      skuId: i.productId,
      quantity: i.quantity,
    }));
    const raw = await bridge.patchItems(payload, branchId);
    return parseCart(raw, this.id);
  }

  /** Estado actual del carro (GET /cart). */
  async getCart(session: Session): Promise<Cart> {
    const bridge = this.requireCartBridge(session);
    const branchId = this.requireBranch(session);
    const raw = await bridge.readCart(branchId);
    return parseCart(raw, this.id);
  }

  private requireCartBridge(session: Session) {
    if (!session.cartBridge) {
      throw new Error(
        "El carro requiere una sesión con puente de carro (cartBridge): el " +
          "navegador logueado del usuario ejecuta GET /cart y PATCH /cart/items " +
          "con su token. El servidor MCP nunca ve credenciales. Ver docs §sesión."
      );
    }
    return session.cartBridge;
  }

  private requireBranch(session: Session): string {
    if (!session.branchId) {
      throw new Error(
        "El carro requiere branchId (sucursal de la sesión, ej. \"jumboclj512\")."
      );
    }
    return session.branchId;
  }
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

/**
 * variations_map de Constructor para scoping por sucursal. Verificado el
 * 2026-07-06: filter_by sobre data.storeId devuelve precio/stock de esa
 * tienda. Los ids de sucursal son tipo "jumboclj512".
 */
export function buildVariationsMap(branchId: string) {
  return {
    group_by: [{ name: "variation", field: "data.variation_id" }],
    values: {
      price: { aggregation: "min", field: "data.price" },
      sellingPrice: { aggregation: "min", field: "data.sellingPrice" },
      listPrice: { aggregation: "min", field: "data.listPrice" },
      stockLevel: { aggregation: "first", field: "data.stockLevel" },
      storeId: { aggregation: "first", field: "data.storeId" },
    },
    dtype: "array",
    filter_by: { and: [{ field: "data.storeId", value: branchId }] },
  };
}

/** Descripción legible de la ficha: prioriza el texto, cae al meta tag. */
function cencosudDescription(data: any): string | undefined {
  const raw =
    (typeof data?.description === "string" && data.description) ||
    (typeof data?.metaTagDescription === "string" && data.metaTagDescription) ||
    undefined;
  if (!raw) return undefined;
  // limpiar HTML y recortar
  const text = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > 0 ? text.slice(0, 600) : undefined;
}

/**
 * Ingredientes de la ficha. Cencosud los expone en `ingredients` top-level
 * y/o en `specifications` con key "ingredients".
 */
function cencosudIngredients(data: any): string[] {
  const top = Array.isArray(data?.ingredients) ? data.ingredients : [];
  const spec = Array.isArray(data?.specifications)
    ? (data.specifications.find(
        (s: any) => String(s?.key).toLowerCase() === "ingredients"
      )?.value ?? [])
    : [];
  const all = [...top, ...spec]
    .filter((x) => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim());
  return [...new Set(all)];
}

/** Búsqueda en profundidad sobre el árbol de categorías de Constructor. */
function findGroup(
  groups: ConstructorGroup[],
  match: (g: ConstructorGroup) => boolean
): ConstructorGroup | undefined {
  for (const g of groups) {
    if (match(g)) return g;
    const child = findGroup(g.children ?? [], match);
    if (child) return child;
  }
  return undefined;
}

/** SkuData viene como arreglo con un string JSON keyed por sku id. */
function parseSkuData(data: Record<string, unknown>): CencosudSkuData | null {
  const raw = (data.SkuData as string[] | undefined)?.[0];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, CencosudSkuData>;
    const first = Object.values(parsed)[0];
    return first ?? null;
  } catch {
    return null;
  }
}

/**
 * Extrae el estado deshidratado de React Query embebido en el HTML SSR de
 * la PDP: un JSON que empieza con {"mutations":[],"queries":. Se balancean
 * llaves porque va inline dentro de un <script> con más contenido.
 */
export function extractDehydratedState(html: string): unknown | null {
  const marker = '{"mutations":[],"queries":';
  const start = html.indexOf(marker);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
