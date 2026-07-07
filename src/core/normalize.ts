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

/**
 * Parsea un precio en formato chileno string ("$1.290", "1.290", "$ 950")
 * a entero CLP. El punto es separador de miles. Devuelve undefined si no
 * hay dígitos.
 */
export function parseClpString(value: unknown): number | undefined {
  if (typeof value === "number") return toClp(value);
  if (typeof value !== "string") return undefined;
  const digits = value.replace(/[^\d]/g, "");
  if (digits.length === 0) return undefined;
  return Number(digits);
}

/**
 * Extrae precio por unidad y unidad de un texto tipo "$2.500 x litro",
 * "$1.190 x kg", "$738 x L".
 */
export function parseUnitPriceString(
  value: unknown
): { unitPrice: number; unit: string } | undefined {
  if (typeof value !== "string") return undefined;
  const m = value.match(/\$?\s*([\d.]+)\s*x\s*([a-zA-Z]+)/);
  if (!m) return undefined;
  const unitPrice = Number(m[1].replace(/\./g, ""));
  if (!Number.isFinite(unitPrice)) return undefined;
  return { unitPrice, unit: normalizeUnit(m[2]) };
}

/** Normaliza etiquetas de unidad a formas cortas: kg, lt, un. */
export function normalizeUnit(unit: string): string {
  const u = normalizeText(unit);
  if (u === "litro" || u === "l" || u === "lt") return "lt";
  if (u === "kilo" || u === "kg" || u === "k") return "kg";
  if (u === "un" || u === "unidad") return "un";
  return u;
}
