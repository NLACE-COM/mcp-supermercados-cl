/** Helpers de normalización compartidos entre adaptadores. */

/** Minúsculas y sin tildes, para matching de texto entre cadenas. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/**
 * Precio por unidad base en CLP. `multiplier` es cuántas unidades base
 * contiene el producto (ej: paquete de 400 g con unidad kg => 0.4).
 */
export function computeUnitPrice(
  price: number,
  multiplier: number | undefined
): number | undefined {
  if (!multiplier || multiplier <= 0 || !Number.isFinite(multiplier)) {
    return undefined;
  }
  return Math.round(price / multiplier);
}

/** Convierte a entero CLP; descarta valores no válidos. */
export function toClp(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n);
}
