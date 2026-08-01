/**
 * Lectura del payload RSC (React Server Components) que emite el App Router
 * de Next.js.
 *
 * Contexto (verificado 2026-08-01): Jumbo migró la PDP de Pages Router a App
 * Router. El HTML dejó de traer el estado deshidratado de React Query
 * (`{"mutations":[],"queries":…}`) y ahora el producto viaja en el stream de
 * RSC, repartido en decenas de trozos:
 *
 *   <script>self.__next_f.push([1,"<fragmento escapado del payload>"])</script>
 *
 * Cada `push` lleva un pedazo del payload como string JSON escapado. Un mismo
 * objeto puede quedar partido entre dos trozos, así que hay que desescapar
 * cada uno y CONCATENAR antes de buscar nada.
 *
 * La forma del objeto de producto no cambió (`{productId, brand, items[]}` con
 * `promotions[].userProperties === "PRIME_USER"`), así que solo cambia de
 * dónde se extrae: el mapeo posterior (mapPdpData) sigue igual.
 */

/**
 * Recorta el JSON balanceado que empieza en `start` (que debe apuntar a `{`).
 * Respeta comillas y escapes, porque el objeto va inline entre más contenido.
 */
export function sliceBalancedJson(text: string, start: number): string | null {
  if (text[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
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
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Reconstruye el payload RSC completo a partir de los `self.__next_f.push`
 * del HTML. Devuelve "" si la página no es App Router.
 *
 * Cada trozo se desescapa por separado (es un string JSON válido por sí
 * mismo); uno corrupto se salta en vez de tumbar la lectura entera.
 */
export function extractRscPayload(html: string): string {
  const chunks: string[] = [];
  for (const match of html.matchAll(/self\.__next_f\.push\(\[1,"(.*?)"\]\)/gs)) {
    try {
      chunks.push(JSON.parse(`"${match[1]}"`) as string);
    } catch {
      continue;
    }
  }
  return chunks.join("");
}

/**
 * Busca en el payload el objeto de producto correspondiente a `slug`.
 *
 * La PDP embebe MUCHOS objetos `"product":{…}`: el principal y los de los
 * carruseles ("Te podrían interesar", "Productos relacionados"). Por eso se
 * exige que el `slug` coincida con el de la URL pedida en vez de tomar el
 * primero: devolver el producto equivocado sería peor que no devolver nada.
 *
 * Además se exige `items[]` no vacío, porque el mismo producto aparece también
 * en bloques sin precios (solo metadatos), que no sirven para mapear.
 */
export function findProductInRscPayload(payload: string, slug: string): unknown | null {
  let fallbackWithoutSlug: unknown | null = null;

  for (const match of payload.matchAll(/"product":\{/g)) {
    const start = match.index + '"product":'.length;
    const raw = sliceBalancedJson(payload, start);
    if (!raw) continue;

    let parsed: { slug?: string; items?: unknown[] };
    try {
      parsed = JSON.parse(raw) as { slug?: string; items?: unknown[] };
    } catch {
      continue;
    }
    if (!Array.isArray(parsed.items) || parsed.items.length === 0) continue;

    if (parsed.slug === slug) return parsed;
    // Algunas PDP no repiten el slug dentro del objeto; se guarda como último
    // recurso, pero solo si NINGÚN candidato coincide por slug.
    if (parsed.slug === undefined && fallbackWithoutSlug === null) {
      fallbackWithoutSlug = parsed;
    }
  }

  return fallbackWithoutSlug;
}
