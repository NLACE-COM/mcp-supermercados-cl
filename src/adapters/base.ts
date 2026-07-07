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

/**
 * Interfaz de adaptador por cadena. La sesión es parámetro de primera clase:
 * casi todo lo que hace conveniente la lista (precio club, historial,
 * beneficios por RUT) vive detrás del login.
 *
 * Fase 1 implementa la lectura pública. Los métodos con sesión quedan
 * declarados y lanzan NotImplementedError hasta la fase 2/3.
 */
export interface StoreAdapter {
  readonly id: StoreId;

  // --- lectura pública (sin sesión) ---
  searchProducts(query: string, opts?: SearchOpts): Promise<Product[]>;
  /** `idOrUrl`: id interno, slug o URL del producto en el sitio. */
  getProduct(idOrUrl: string, session?: Session): Promise<Product | null>;
  getOffers(opts?: OfferOpts, session?: Session): Promise<Product[]>;

  // --- con sesión del usuario (núcleo del producto, fase 2+) ---
  getFrequentPurchases(session: Session): Promise<Product[]>;
  getSavedLists(session: Session): Promise<ShoppingList[]>;
  /** Precio club / RUT del usuario para un producto. */
  getMemberPrice(id: string, session: Session): Promise<Price>;

  // --- carro (fase 3) ---
  addToCart(items: CartItem[], session: Session): Promise<Cart>;
  getCart(session: Session): Promise<Cart>;
}

export class NotImplementedError extends Error {
  constructor(adapter: StoreId, method: string, phase: string) {
    super(
      `${adapter}.${method} aún no está implementado (llega en la ${phase}).`
    );
    this.name = "NotImplementedError";
  }
}
