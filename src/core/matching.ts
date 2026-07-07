import { normalizeText } from "./normalize.js";

/**
 * Matching de texto en español (chileno) para resolver "lo que el usuario
 * pidió" contra "lo que se llama el producto". El buscador de cada cadena ya
 * hace su matching; esto es para el lado local: emparejar la query con los
 * frecuentes del usuario y descartar candidatos irrelevantes, tolerando
 * plurales, tildes, sinónimos y regionalismos.
 *
 * No pretende ser un stemmer completo del español: es un conjunto acotado de
 * reglas y sinónimos de alto impacto para el supermercado.
 */

/** Palabras vacías que no aportan al match (no discriminan producto). */
const STOPWORDS = new Set([
  "de",
  "la",
  "el",
  "los",
  "las",
  "un",
  "una",
  "con",
  "sin",
  "para",
  "por",
  "y",
  "o",
  "al",
  "del",
  "en",
]);

/**
 * Sinónimos y regionalismos de una sola palabra, frecuentes en Chile. Cada
 * grupo es un conjunto de términos equivalentes que se expanden entre sí.
 * Mantener en singular y normalizado (sin tildes). Los equivalentes de varias
 * palabras van en PHRASE_CANON.
 */
const SYNONYM_GROUPS: string[][] = [
  ["palta", "aguacate"],
  ["bebida", "gaseosa", "refresco", "soda"],
  ["jugo", "nectar"],
  ["frutilla", "fresa"],
  ["durazno", "melocoton"],
  ["poroto", "frijol", "judia"],
  ["choclo", "maiz"],
  ["betarraga", "remolacha"],
  ["zapallo", "calabaza"],
  ["zapallito", "zucchini", "calabacin"],
  ["ciruela", "guinda"],
  ["damasco", "albaricoque"],
  ["pomelo", "toronja"],
  ["mani", "cacahuate", "cacahuete"],
  ["colacion", "snack", "picoteo"],
  ["cabritas", "palomitas", "pochoclo"],
  ["lavaloza", "lavavajilla", "lavaplatos"],
  ["cotona", "delantal"],
  ["fosforo", "cerillo"],
  ["pañal", "panal", "diaper"],
  ["queque", "bizcocho"],
  ["vienesa", "salchicha"],
  ["longaniza", "chorizo"],
];

/**
 * Frases (varias palabras) que se colapsan a un token canónico ANTES de
 * tokenizar, para que un sinónimo multi-palabra empareje con su equivalente
 * de una palabra. Ej: "papel higienico" -> "confort". El token canónico puede
 * a su vez estar en SYNONYM_GROUPS. Normalizado, sin tildes.
 */
const PHRASE_CANON: Array<[string, string[]]> = [
  ["confort", ["papel higienico"]],
  ["detergente", ["jabon de ropa"]],
  ["marraqueta", ["pan batido", "pan frances"]],
  ["hallulla", ["pan hallulla"]],
  ["posta", ["carne molida"]],
  ["toallanova", ["toalla de papel", "toalla nova"]],
];

/** term normalizado -> conjunto de equivalentes (incluye el propio término). */
const SYNONYMS: Map<string, Set<string>> = (() => {
  const map = new Map<string, Set<string>>();
  for (const group of SYNONYM_GROUPS) {
    const norm = group.map((t) => normalizeText(t));
    for (const term of norm) {
      const set = map.get(term) ?? new Set<string>();
      for (const other of norm) set.add(other);
      map.set(term, set);
    }
  }
  return map;
})();

/** Reemplaza frases-sinónimo por su token canónico en un texto normalizado. */
function canonicalizePhrases(normalized: string): string {
  let out = normalized;
  for (const [canon, phrases] of PHRASE_CANON) {
    for (const phrase of phrases) {
      const norm = normalizeText(phrase);
      if (out.includes(norm)) out = out.split(norm).join(canon);
    }
  }
  return out;
}

/**
 * Singulariza de forma laxa una palabra en español. No es exhaustivo: quita
 * la "-s" final y resuelve "-ces" -> "-z" (lapices -> lapiz). Los plurales de
 * consonante ("panes" -> "pane", no "pan") quedan a medias a propósito: el
 * match por subcadena de `matchScore` cierra esa brecha ("pane" ⊂ "pan"
 * falla, pero "pan" ⊂ "pane" acierta). Palabras cortas quedan intactas para
 * no romper ("mes" -> "mes", "gas" -> "gas").
 */
export function singularize(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ces")) return word.slice(0, -3) + "z"; // lapices -> lapiz
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/** Raíz canónica de un token: normalizado + singular. */
function stem(token: string): string {
  return singularize(normalizeText(token));
}

/**
 * Tokens significativos de un texto: normalizados, singularizados, sin
 * stopwords ni tokens de 1 caracter. Preserva números (ej. "1kg", "500").
 */
export function tokens(text: string): string[] {
  return canonicalizePhrases(normalizeText(text))
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map((t) => singularize(t));
}

/** ¿Dos tokens (ya "stemmed") son equivalentes por igualdad o sinónimo? */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const syn = SYNONYMS.get(a);
  return syn ? syn.has(b) : false;
}

/**
 * ¿Cuántos tokens de la query están cubiertos por el nombre del candidato
 * (por igualdad, sinónimo o inclusión de subcadena)? Devuelve un score
 * 0..1 = fracción de tokens de la query cubiertos. Un token numérico de la
 * query (ej. "1", "500") debe aparecer exacto para contar.
 */
export function matchScore(query: string, candidateName: string): number {
  const q = tokens(query);
  if (q.length === 0) return 0;
  const nameTokens = tokens(candidateName);
  const nameStems = new Set(nameTokens.map(stem));

  let covered = 0;
  for (const qt of q) {
    const s = stem(qt);
    const hit =
      nameStems.has(s) ||
      nameTokens.some((nt) => tokensMatch(s, stem(nt))) ||
      // Inclusión de subcadena para plurales de consonante y variantes
      // ("pan" ⊂ "pane"). Solo tokens largos (≥4) no numéricos, y con
      // diferencia de largo ≤2 para no emparejar "agua" con "aguacate".
      (!/^\d+$/.test(s) &&
        s.length >= 4 &&
        nameTokens.some(
          (nt) =>
            Math.abs(nt.length - s.length) <= 2 && (nt.includes(s) || s.includes(nt))
        ));
    if (hit) covered += 1;
  }
  return covered / q.length;
}

/**
 * ¿El candidato satisface la query? Por defecto exige cubrir TODOS los tokens
 * significativos (umbral 1.0), tolerando plurales/tildes/sinónimos. Con un
 * umbral menor, acepta coincidencias parciales (útil para queries largas).
 */
export function matchesQuery(
  query: string,
  candidateName: string,
  threshold = 1
): boolean {
  return matchScore(query, candidateName) >= threshold;
}
