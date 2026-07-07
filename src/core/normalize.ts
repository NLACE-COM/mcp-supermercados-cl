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

/**
 * Parsea el texto de una promoción multi-compra a estructura. Reconoce los
 * patrones comunes de las cadenas chilenas:
 *  - "Combina 2 x $4.890" / "2 X $3.000" / "Lleva 8 por $5.600" -> bundle
 *  - "4 por 3 a $2.700" / "2x1" -> nxm
 * Devuelve undefined si no reconoce el patrón.
 */
export function parseBundle(
  text: string | null | undefined
):
  | {
      description: string;
      type: string;
      minQuantity?: number;
      bundlePrice?: number;
      unitPriceInBundle?: number;
    }
  | undefined {
  if (!text || typeof text !== "string") return undefined;
  const desc = text.trim().replace(/\s+/g, " ");
  if (desc.length === 0) return undefined;

  // "N x $X", "combina N x $X", "lleva N por $X" — el $ distingue del NxM.
  const bundle = desc.match(
    /(?:combina|lleva)?\s*(\d+)\s*(?:x|por)\s*\$\s*([\d.]+)/i
  );
  if (bundle) {
    const minQuantity = Number(bundle[1]);
    const bundlePrice = Number(bundle[2].replace(/\./g, ""));
    if (
      Number.isFinite(minQuantity) &&
      minQuantity > 1 &&
      Number.isFinite(bundlePrice) &&
      bundlePrice > 0
    ) {
      return {
        description: desc,
        type: "bundle",
        minQuantity,
        bundlePrice,
        unitPriceInBundle: Math.round(bundlePrice / minQuantity),
      };
    }
  }

  // "NxM" tipo "2x1", "3x2"
  const nxm = desc.match(/(\d+)\s*x\s*(\d+)\b/i);
  if (nxm && !/\$/.test(desc)) {
    return { description: desc, type: "nxm", minQuantity: Number(nxm[1]) };
  }

  // Cualquier otra promo textual (la conservamos como descripción).
  return { description: desc, type: "descuento" };
}

/** Normaliza etiquetas de unidad a formas cortas: kg, lt, un. */
export function normalizeUnit(unit: string): string {
  const u = normalizeText(unit);
  if (u === "litro" || u === "l" || u === "lt") return "lt";
  if (u === "kilo" || u === "kg" || u === "k") return "kg";
  if (u === "un" || u === "unidad") return "un";
  return u;
}
