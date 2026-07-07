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
 * No toda cadena implementa todo: los métodos sin soporte lanzan
 * NotImplementedError con un mensaje que explica la limitación.
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
