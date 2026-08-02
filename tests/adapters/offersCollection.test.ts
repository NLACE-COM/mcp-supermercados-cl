import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CencosudAdapter, JUMBO_CONFIG } from "../../src/adapters/cencosud.js";
import {
  extractCollectionIdCandidates,
  isOffersCollectionName,
  parseCollectionDateTo,
  pickBestOffersCollection,
  type CollectionProbe,
} from "../../src/adapters/cencosudOffersCollection.js";
import { HttpStatusError, type HttpFetcher } from "../../src/http/client.js";

const landingHtml = readFileSync(
  fileURLToPath(
    new URL("../fixtures/jumbo-ofertas-landing-2026-08-01.html", import.meta.url)
  ),
  "utf-8"
);

/** Colecciones reales sondeadas el 2026-08-01 (issue #18). */
const REAL_COLLECTIONS: Record<
  string,
  { name: string; total: number; dateTo: string }
> = {
  "30930": {
    name: "Collection-Todaslasofertaslpmciclo2ladespensa",
    total: 8714,
    dateTo: '"2026-08-18T23:59:00.000Z"',
  },
  "30774": {
    name: "Collection-Todaslasofertaslpmciclo1ladespensa",
    total: 5632,
    dateTo: '"2026-08-15T23:59:00.000Z"',
  },
  "30632": {
    name: "Collection-Todaslasofertasdelciclo5LPM",
    total: 5426,
    dateTo: '"2026-08-02T23:59:00.000Z"',
  },
  "30762": {
    name: "Collection-TodaslasofertasdelaLPMAgostoaniversario",
    total: 4113,
    dateTo: '"2026-08-28T23:59:00.000Z"',
  },
  // No es un listado general de ofertas: no debe ganar aunque sea frecuente.
  "28992": {
    name: "EC ECOMMERCE COLECCION ESPECIAL MARKETING",
    total: 3921,
    dateTo: '"2026-12-31T23:59:00.000Z"',
  },
};

describe("cencosudOffersCollection · extracción de candidatos", () => {
  it("saca los ids del SSR del landing y prioriza los más frecuentes", () => {
    const ids = extractCollectionIdCandidates(landingHtml);

    // 28992 y 30930 están en los 5 productos; deben quedar al frente.
    expect(ids.slice(0, 2).sort()).toEqual(["28992", "30930"]);
    // También capta los ids de banner (`fq=H%3A`), aunque pesen menos.
    expect(ids).toContain("30765");
    expect(ids).toContain("30771");
  });

  it("no cuenta dos veces un id repetido dentro del mismo producto", () => {
    const html = '\\"collections\\":[\\"111\\",\\"111\\",\\"222\\"]';
    // Empatan en 1 producto cada uno, así que desempata el id menor.
    expect(extractCollectionIdCandidates(html)).toEqual(["111", "222"]);
  });

  it("tolera el JSON sin escapar (no solo el escapado de Next)", () => {
    expect(extractCollectionIdCandidates('"collections": ["30930"]')).toEqual([
      "30930",
    ]);
  });
});

describe("cencosudOffersCollection · elección de la colección vigente", () => {
  it("reconoce los nombres de listado general de ofertas y descarta el resto", () => {
    expect(
      isOffersCollectionName("Collection-Todaslasofertaslpmciclo2ladespensa")
    ).toBe(true);
    expect(
      isOffersCollectionName("Collection-TodaslasofertasdelaLPMAgostoaniversario")
    ).toBe(true);
    expect(isOffersCollectionName("EC ECOMMERCE COLECCION ESPECIAL MARKETING")).toBe(
      false
    );
    expect(isOffersCollectionName("Collection-OfertasPepsi")).toBe(false);
  });

  it("parsea el dateTo con comillas literales y trata 'null' como sin fecha", () => {
    expect(parseCollectionDateTo('"2026-08-18T23:59:00.000Z"')).toBe(
      Date.parse("2026-08-18T23:59:00.000Z")
    );
    expect(parseCollectionDateTo('"null"')).toBeUndefined();
    expect(parseCollectionDateTo(undefined)).toBeUndefined();
  });

  it("elige la colección de ofertas vigente con más productos", () => {
    const probes: CollectionProbe[] = [
      {
        id: "28992",
        displayName: REAL_COLLECTIONS["28992"].name,
        total: 3921,
        active: true,
      },
      {
        id: "30930",
        displayName: REAL_COLLECTIONS["30930"].name,
        total: 8714,
        active: true,
      },
      {
        id: "30774",
        displayName: REAL_COLLECTIONS["30774"].name,
        total: 5632,
        active: true,
      },
    ];
    // 28992 tiene menos productos, pero además no es un listado de ofertas.
    expect(pickBestOffersCollection(probes)?.id).toBe("30930");
  });

  it("descarta las vencidas aunque sean las más grandes", () => {
    const now = Date.parse("2026-08-10T00:00:00.000Z");
    const probes: CollectionProbe[] = [
      {
        id: "30930",
        displayName: REAL_COLLECTIONS["30930"].name,
        total: 8714,
        active: true,
        expiresAt: Date.parse("2026-08-02T23:59:00.000Z"), // ya venció
      },
      {
        id: "30762",
        displayName: REAL_COLLECTIONS["30762"].name,
        total: 4113,
        active: true,
        expiresAt: Date.parse("2026-08-28T23:59:00.000Z"),
      },
    ];
    expect(pickBestOffersCollection(probes, now)?.id).toBe("30762");
  });

  it("descarta las inactivas y devuelve undefined si no queda ninguna", () => {
    const probes: CollectionProbe[] = [
      {
        id: "30930",
        displayName: REAL_COLLECTIONS["30930"].name,
        total: 8714,
        active: false,
      },
      {
        id: "28992",
        displayName: REAL_COLLECTIONS["28992"].name,
        total: 3921,
        active: true,
      },
    ];
    expect(pickBestOffersCollection(probes)).toBeUndefined();
  });
});

/**
 * Http falso que reproduce el escenario del issue #18: la colección semilla
 * expiró (404) y hay que redescubrir la vigente desde el landing.
 */
function makeRotatedHttp(expiredId: string) {
  const calls: string[] = [];
  const http: HttpFetcher = {
    async getJson<T>(url: string): Promise<T> {
      calls.push(url);
      const id = new URL(url).pathname.split("/").pop() ?? "";
      if (id === expiredId) throw new HttpStatusError(url, 404);
      const collection = REAL_COLLECTIONS[id];
      if (!collection) throw new HttpStatusError(url, 404);
      return {
        response: {
          results: [
            {
              value: "Arroz Banquete 1 kg",
              data: {
                id: `sku-${id}`,
                sellingPrice: 1790,
                listPrice: 2440,
                url: "/arroz-banquete-1-kg/p",
              },
            },
          ],
          total_num_results: collection.total,
          collection: {
            id,
            display_name: collection.name,
            data: { active: "true", dateTo: collection.dateTo },
          },
        },
      } as T;
    },
    async getText(url: string): Promise<string> {
      calls.push(url);
      return landingHtml;
    },
  };
  return { http, calls };
}

describe("CencosudAdapter · ofertas se auto-reparan cuando la colección rota", () => {
  it("ante 404 redescubre la colección vigente y devuelve productos (issue #18)", async () => {
    // JUMBO_CONFIG apunta a 30930; simulamos que ESA expiró para probar el
    // camino de rotación sin depender del id que esté configurado hoy.
    const expired = JUMBO_CONFIG.offersCollectionId!;
    const { http, calls } = makeRotatedHttp(expired);
    const adapter = new CencosudAdapter(JUMBO_CONFIG, http, "test-uuid");

    const products = await adapter.getOffers({ limit: 3 });

    expect(products.length).toBeGreaterThan(0);
    // Pasó por el landing a buscar candidatos...
    expect(calls.some((u) => u.endsWith("/jumbo-ofertas"))).toBe(true);
    // ...y terminó sirviendo desde una colección viva distinta de la expirada.
    const browsed = calls.filter((u) => u.includes("/browse/collection_id/"));
    const finalId = new URL(browsed[browsed.length - 1]).pathname.split("/").pop();
    expect(finalId).not.toBe(expired);
    expect(REAL_COLLECTIONS[finalId!].name).toMatch(/todaslasofertas/i);
  });

  it("no vuelve a sondear el landing en la siguiente consulta (cachea el id)", async () => {
    const expired = JUMBO_CONFIG.offersCollectionId!;
    const { http, calls } = makeRotatedHttp(expired);
    const adapter = new CencosudAdapter(JUMBO_CONFIG, http, "test-uuid");

    await adapter.getOffers({ limit: 3 });
    const afterFirst = calls.filter((u) => u.endsWith("/jumbo-ofertas")).length;
    // limit distinto => otra clave de cache de productos, pero el id ya está resuelto.
    await adapter.getOffers({ limit: 5 });

    expect(afterFirst).toBe(1);
    expect(calls.filter((u) => u.endsWith("/jumbo-ofertas"))).toHaveLength(1);
  });

  it("un error que no es 404 se propaga sin tocar el landing", async () => {
    const calls: string[] = [];
    const http: HttpFetcher = {
      async getJson<T>(url: string): Promise<T> {
        calls.push(url);
        throw new HttpStatusError(url, 500);
      },
      async getText(url: string): Promise<string> {
        calls.push(url);
        return landingHtml;
      },
    };
    const adapter = new CencosudAdapter(JUMBO_CONFIG, http, "test-uuid");

    // Un 500 es caída puntual, no rotación: redescubrir sería ruido inútil.
    await expect(adapter.getOffers({ limit: 3 })).rejects.toThrow(/500/);
    expect(calls.some((u) => u.endsWith("/jumbo-ofertas"))).toBe(false);
  });
});
