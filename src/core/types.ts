import { z } from "zod";

/**
 * Esquema normalizado del proyecto. Todas las cadenas se mapean a estas
 * estructuras. Los precios son siempre CLP enteros.
 *
 * Regla central del plan: precio normal y precio club/socio van SEPARADOS,
 * porque el "mejor precio" depende de si el usuario tiene el beneficio.
 */

export const STORE_IDS = [
  "jumbo",
  "santaisabel",
  "unimarc",
  "tottus",
  "lider",
] as const;

export const StoreIdSchema = z.enum(STORE_IDS);
export type StoreId = z.infer<typeof StoreIdSchema>;

export const OfferSchema = z.object({
  /** "descuento" | "2x1" | "club" | "oferta" | etc. */
  type: z.string(),
  description: z.string().optional(),
  /** true si la oferta aplica solo a socios (Jumbo Prime, Club Unimarc, ...) */
  clubOnly: z.boolean().optional(),
});
export type Offer = z.infer<typeof OfferSchema>;

export const PriceSchema = z.object({
  /** Precio vigente público en CLP (con oferta aplicada si la hay) */
  price: z.number().int().nonnegative(),
  /** Precio de lista sin descuento, si difiere del vigente */
  listPrice: z.number().int().positive().optional(),
  /** Precio socio (club / Prime / RUT), si existe */
  memberPrice: z.number().int().positive().optional(),
});
export type Price = z.infer<typeof PriceSchema>;

export const ProductSchema = z.object({
  store: StoreIdSchema,
  /** Identificador del producto dentro de la cadena (SKU id) */
  id: z.string(),
  sku: z.string().optional(),
  ean: z.string().optional(),
  name: z.string(),
  brand: z.string().optional(),
  /** Descripción/ficha corta del producto (para enriquecer al modelo) */
  description: z.string().optional(),
  /** Precio vigente público en CLP */
  price: z.number().int().nonnegative(),
  /** Precio normal/lista si hay descuento */
  listPrice: z.number().int().positive().optional(),
  /** Precio socio (Prime/club), separado del público a propósito */
  memberPrice: z.number().int().positive().optional(),
  /** Precio por unidad base (CLP por kg/lt/un) para comparar formatos */
  unitPrice: z.number().nonnegative().optional(),
  /** Unidad base del unitPrice: "kg" | "lt" | "un" | ... */
  unit: z.string().optional(),
  offer: OfferSchema.optional(),
  /**
   * Ingredientes del producto (de la ficha). Base para juicios de
   * "naturalidad" / "menos ingredientes" — el modelo razona sobre esta lista.
   * Disponible en get_product de las cadenas que exponen ficha.
   */
  ingredients: z.array(z.string()).optional(),
  /** Sellos/flags nutricionales de la ficha (ej. "alto en azúcares"). */
  nutritionalFlags: z.array(z.string()).optional(),
  inStock: z.boolean(),
  imageUrl: z.string().url().optional(),
  url: z.string().url().optional(),
  /** ISO timestamp de cuándo se obtuvo el dato */
  fetchedAt: z.string(),
});
export type Product = z.infer<typeof ProductSchema>;

/**
 * Sesión de usuario en una cadena. El servidor MCP nunca ve ni pide
 * credenciales: recibe material de sesión ya emitido por el navegador del
 * usuario.
 *
 * Verificado en Jumbo (2026-07-07): el token de sesión vive en el
 * localStorage del sitio (`sessionDataToken`, `userData`), no solo en
 * cookies. Por eso la vía de producción es un `SessionProvider` que opera
 * el navegador del usuario (Playwright con su perfil) y entrega el HTML ya
 * autenticado de las páginas de cuenta. Ver `adapters/session.ts`.
 */
export interface Session {
  store: StoreId;
  /** Sucursal/tienda asociada a la sesión (ej: "jumboclj512") */
  branchId?: string;
  /**
   * Provider que devuelve el HTML autenticado de una ruta del sitio
   * (ej. "/productos-frecuentes"). Lo implementa el puente de navegador.
   */
  fetchAuthedHtml?: (path: string) => Promise<string>;
  /**
   * Alternativa: el DOM de productos ya extraído por el navegador, para
   * cuando el puente prefiere entregar datos en vez de HTML crudo.
   */
  frequentCards?: FrequentCard[];
  /**
   * Puente de carro: el navegador del usuario ejecuta las llamadas
   * autenticadas al BFF (GET /cart, PATCH /cart/items) con su token, y
   * devuelve el JSON crudo del carro. El servidor MCP nunca ve el token.
   */
  cartBridge?: CartBridge;
  /**
   * JSON crudo de las listas guardadas que el navegador ya obtuvo
   * (GET /lists y GET /lists/{scope}/{idList}). Camino consistente con
   * frequentCards: el servidor no ve el token, solo normaliza.
   */
  savedListsRaw?: unknown;
}

/**
 * Puente de carro hacia el navegador del usuario. `readCart` mapea a
 * GET /cart; `patchItems` a PATCH /cart/items. Ambos devuelven el JSON
 * crudo del carro para que el adaptador lo normalice.
 */
export interface CartBridge {
  readCart(branchId: string): Promise<unknown>;
  patchItems(
    items: Array<{ skuId: string; quantity: number }>,
    branchId: string
  ): Promise<unknown>;
}

/**
 * Representación cruda de una card de producto tal como la entrega el DOM
 * de Jumbo (atributos data-cnstrc-item-* + textos de precio). El parser la
 * normaliza a Product.
 */
export interface FrequentCard {
  id: string;
  name: string;
  /** Valor de data-cnstrc-item-price: precio vigente confiable */
  dataPrice?: string;
  href?: string | null;
  tachado?: string | null;
  ppuNodes?: string[];
  /** Texto "Paga $X" del badge Prime */
  prime?: string | null;
  innerText?: string;
}

export const CartItemSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().positive(),
});
export type CartItem = z.infer<typeof CartItemSchema>;

export const CartLineSchema = z.object({
  product: ProductSchema,
  quantity: z.number().int().positive(),
  /** Total de la línea al precio vigente (price * quantity) en CLP */
  lineTotal: z.number().int().nonnegative(),
});
export type CartLine = z.infer<typeof CartLineSchema>;

export const CartSchema = z.object({
  store: StoreIdSchema,
  items: z.array(CartLineSchema),
  /** Cantidad total de unidades en el carro */
  itemsQuantity: z.number().int().nonnegative(),
  /** Suma sin descuentos (precio lista) en CLP */
  subTotal: z.number().int().nonnegative(),
  /** Total que paga el usuario, con sus descuentos aplicados (incl. Prime) */
  total: z.number().int().nonnegative(),
  /** Ahorro total respecto al subtotal (subTotal - total) */
  savings: z.number().int().nonnegative(),
  /** Parte del ahorro atribuible al beneficio socio Prime, si aplica */
  primeSavings: z.number().int().nonnegative().optional(),
});
export type Cart = z.infer<typeof CartSchema>;

export const ShoppingListSchema = z.object({
  store: StoreIdSchema,
  id: z.string(),
  name: z.string(),
  items: z.array(CartItemSchema),
});
export type ShoppingList = z.infer<typeof ShoppingListSchema>;

export interface SearchOpts {
  /** Máximo de resultados (default 10) */
  limit?: number;
  /** Página, base 1 */
  page?: number;
  /**
   * Sucursal de la cadena para precios y stock locales
   * (ej. Cencosud: "jumboclj512"). Sin esto, catálogo nacional.
   */
  branchId?: string;
  /** Sesión del usuario: si existe, los precios devueltos son los suyos */
  session?: Session;
}

export interface OfferOpts {
  /** Nombre de categoría para filtrar (ej. "Despensa"); se resuelve a group_id */
  category?: string;
  branchId?: string;
  limit?: number;
  page?: number;
  /** Solo ofertas exclusivas de socios (Jumbo Prime) */
  primeOnly?: boolean;
}
