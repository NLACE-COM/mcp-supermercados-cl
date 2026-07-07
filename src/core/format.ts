/**
 * Formato de cara al usuario (chileno). Las tools devuelven números crudos
 * para que el modelo calcule, pero incluir también el texto formateado ayuda a
 * que responda parejo ("$12.345" en vez de 12345, ahorro en %).
 */

/** CLP entero a texto chileno: 12345 -> "$12.345". */
export function formatClp(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const n = Math.round(value);
  const sign = n < 0 ? "-" : "";
  const digits = Math.abs(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}$${digits}`;
}

/** Porcentaje de ahorro sobre un total, redondeado. 0 si no aplica. */
export function savingPct(saving: number, base: number): number {
  if (base <= 0 || saving <= 0) return 0;
  return Math.round((saving / base) * 100);
}
