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
  inStock: z.boolean(),
  imageUrl: z.string().url().optional(),
  url: z.string().url().optional(),
  /** ISO timestamp de cuándo se obtuvo el dato */
  fetchedAt: z.string(),
});
export type Product = z.infer<typeof ProductSchema>;

/**
 * Sesión de usuario en una cadena. Fase 2: se llenará desde el navegador
 * del usuario (Playwright con su perfil) o cookies exportadas. El servidor
 * MCP nunca ve credenciales, solo material de sesión ya emitido.
 */
export interface Session {
  store: StoreId;
  cookies?: Record<string, string>;
  /** Sucursal/tienda asociada a la sesión (ej: "jumboclj512") */
  branchId?: string;
}

export const CartItemSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().positive(),
});
export type CartItem = z.infer<typeof CartItemSchema>;

export const CartSchema = z.object({
  store: StoreIdSchema,
  items: z.array(
    z.object({
      product: ProductSchema,
      quantity: z.number().int().positive(),
    })
  ),
  total: z.number().int().nonnegative(),
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
