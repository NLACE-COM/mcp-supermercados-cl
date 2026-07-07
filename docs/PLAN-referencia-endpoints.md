# Plan: MCP de Supermercados Chilenos

Servidor MCP open source para buscar productos, comparar precios y armar listas de supermercado con Claude o ChatGPT, cubriendo Jumbo, Santa Isabel, Lider, Tottus y Unimarc.

Fecha del reconocimiento técnico: 6 de julio de 2026. Todos los endpoints listados fueron observados o verificados en esa fecha.

---

## 1. Objetivo

Permitir a cualquier persona conectar su asistente de IA a los supermercados chilenos para:

1. Buscar productos y precios en una o todas las cadenas
2. Comparar precio total y precio por unidad entre cadenas
3. Ver ofertas y promociones
4. Armar listas de compra (v1: exportables; v2: carro real en Jumbo con sesión propia)

Producto: paquete npm instalable con `npx`, 100% local. Sin backend central. El tráfico sale de la IP de cada usuario y las credenciales nunca salen de su máquina.

---

## 2. Hallazgos técnicos verificados

### 2.1 Jumbo + Santa Isabel (Cencosud) — la misma plataforma

Ambos sitios comparten backend. Un solo adaptador cubre las dos cadenas.

**Búsqueda: Constructor.io** (motor de search-as-a-service)

- Endpoint Jumbo (VERIFICADO server-side, responde JSON completo sin cookies ni login):
  ```
  GET https://pwcdauseo-zone.cnstrc.com/search/{query}?key=key_JopvNXKS61kwGkBe&i={uuid_cliente}&s=1&num_results_per_page=N
  ```
- La key es pública, va embebida en el frontend de jumbo.cl. Santa Isabel tiene su propia key/índice Constructor: extraerla igual (DevTools > Network > filtro `cnstrc` al cargar una búsqueda).
- La respuesta incluye por producto: nombre, marca (`brandName`), `price`, `stockLevel`, `promotions` (con `promotionName`, descripción, feature), `unit_multiplier` (para precio por unidad), imágenes y URL.
- Parámetros útiles de Constructor: `num_results_per_page`, `page`, `sort_by`, `filters[...]` (facetas por categoría/marca).

**Catálogo complementario: sm-web-api.ecomm.cencosud.com**

- Observado en producción:
  ```
  GET https://sm-web-api.ecomm.cencosud.com/catalog/api/v1/reviews/ratings?ids=1,2,3
  ```
  (VERIFICADO: responde 200; usado por ambos sitios: Jumbo y Santa Isabel)
- Existen más rutas bajo `/catalog/api/` (producto por id, disponibilidad por tienda). Requieren headers correctos (probable `x-api-key` o `apiKey` embebida en el bundle JS). Mapearlas en la Fase 1 con DevTools.

**Carro y sesión**: requiere login Cencosud (token de sesión). Va en Fase 4 vía Playwright con sesión persistente del usuario.

**Nota**: la página de búsqueda es SSR; el HTML también trae los datos si Constructor cambiara.

### 2.2 Lider (Walmart Chile)

- El supermercado vive en `super.lider.cl` (redirige desde lider.cl/supermercado). Plataforma Glass de Walmart, la misma de walmart.com.
- API principal (OBSERVADO en navegador, responde 200):
  ```
  POST https://super.lider.cl/orchestra/graphql
  GET  https://super.lider.cl/orchestra/api/ccm/v3/bootstrap
  ```
- GraphQL con persisted queries (hash + variables). Las queries de búsqueda de walmart.com están documentadas por la comunidad; la estructura de Glass Chile es análoga.
- Protección antibots: PerimeterX/HUMAN. Requests fuera de navegador van a fallar con frecuencia.
- **Estrategia**: adaptador vía Playwright (headless o headed) reusando contexto de navegador persistente. Interceptar las respuestas GraphQL en vez de parsear DOM: más estable.
- Búsqueda SSR disponible en `https://super.lider.cl/search?q={query}` como fallback de parsing.

### 2.3 Tottus (Falabella)

- SSR Next.js. La URL de búsqueda devuelve HTML completo con datos a un fetch simple, sin bloqueo (VERIFICADO server-side el 2026-07-06):
  ```
  GET https://www.tottus.cl/tottus-cl/buscar?Ntt={query}
  GET https://www.tottus.cl/tottus-cl/buscar?Ntt={query}&page=2&store=to_com
  ```
- El HTML incluye por producto: marca, nombre, formato, precio normal, precio oferta, % descuento, precio por unidad (KG/LT), promos tipo "2 X $3.000", disponibilidad de envío.
- Implementación: parsear `__NEXT_DATA__` (JSON embebido en el HTML, estructura estable) en vez de scrapear el DOM.
- Paginación: 48 resultados por página, total en el payload.
- Es el adaptador más simple de los cuatro. No hay API pública separada confirmada; el SSR basta.

### 2.4 Unimarc

- Corre sobre VTEX (imágenes en `unimarc.vtexassets.com`, confirmado en producción). Frontend Next.js SSR propio (SMU).
- La página de búsqueda renderiza con precios, precio por unidad, precios Club Unimarc y promos:
  ```
  https://www.unimarc.cl/search?q={query}&page=N
  ```
- Un fetch simple desde datacenter devuelve vacío (bloqueo o render JS). Desde la IP residencial del usuario final es probable otro comportamiento: PROBAR en Fase 2 las APIs VTEX estándar:
  ```
  GET https://www.unimarc.cl/api/catalog_system/pub/products/search/{query}?_from=0&_to=49
  GET https://www.unimarc.cl/api/io/_v/api/intelligent-search/product_search/?query={query}
  ```
- Fallback garantizado: Playwright + parsing de `__NEXT_DATA__`.

### 2.5 Resumen de estrategia por cadena

| Cadena       | Estrategia primaria                      | Fallback                     | Riesgo            |
| ------------ | ---------------------------------------- | ---------------------------- | ----------------- |
| Jumbo        | Constructor.io HTTP directo              | SSR parsing                  | Bajo              |
| Santa Isabel | Constructor.io HTTP directo (key propia) | SSR parsing                  | Bajo              |
| Tottus       | Fetch SSR + `__NEXT_DATA__`              | Playwright                   | Bajo              |
| Unimarc      | API VTEX (validar)                       | Playwright + `__NEXT_DATA__` | Medio             |
| Lider        | Playwright + intercepción GraphQL        | Parsing DOM                  | Alto (PerimeterX) |

---

## 3. Arquitectura

Monorepo TypeScript. Un solo servidor MCP con adaptadores por retailer.

```
supermercado-mcp/
├── package.json              # bin: supermercado-mcp (para npx)
├── tsconfig.json
├── src/
│   ├── index.ts              # entrada: stdio transport del SDK MCP
│   ├── server.ts             # registro de tools
│   ├── schema.ts             # Product, Offer, SearchResult (zod)
│   ├── compare.ts            # lógica de comparación entre cadenas
│   ├── adapters/
│   │   ├── types.ts          # interface StoreAdapter
│   │   ├── cencosud.ts       # Jumbo + Santa Isabel (Constructor.io)
│   │   ├── tottus.ts         # fetch SSR + __NEXT_DATA__
│   │   ├── unimarc.ts        # VTEX API con fallback Playwright
│   │   └── lider.ts          # Playwright + intercepción GraphQL
│   ├── browser/
│   │   └── session.ts        # contexto Playwright persistente compartido
│   └── util/
│       ├── http.ts           # fetch con headers realistas, retry, rate limit
│       └── cache.ts          # cache en disco con TTL (15 min búsquedas)
├── tests/
│   ├── adapters/*.test.ts    # unit con fixtures grabadas
│   └── live/*.live.test.ts   # smoke tests contra sitios reales (opt-in)
└── README.md
```

**Decisiones**:

- SDK: `@modelcontextprotocol/sdk`, transporte stdio. Compatible con Claude Desktop, Claude Code, Cursor y ChatGPT Desktop (vía su soporte MCP).
- Runtime: Node 20+. Playwright como dependencia opcional (`peerDependency` o carga perezosa): sin Playwright funcionan Jumbo, Santa Isabel y Tottus; Lider y Unimarc-fallback piden `npx playwright install chromium` la primera vez.
- Interface del adaptador:
  ```ts
  interface StoreAdapter {
    id: StoreId; // 'jumbo' | 'santa_isabel' | 'lider' | 'tottus' | 'unimarc'
    search(query: string, opts: SearchOpts): Promise<Product[]>;
    getProduct?(id: string): Promise<Product>;
    getOffers?(category?: string): Promise<Product[]>;
    health(): Promise<AdapterHealth>; // para diagnóstico
  }
  ```
- Esquema normalizado (zod, el corazón del proyecto):
  ```ts
  const Product = z.object({
    store: StoreId,
    id: z.string(),
    name: z.string(),
    brand: z.string().nullable(),
    price: z.number(), // CLP, precio vigente
    listPrice: z.number().nullable(), // precio sin descuento
    unitPrice: z.number().nullable(), // CLP por unidad base
    unitLabel: z.string().nullable(), // 'kg' | 'lt' | 'un'
    promo: z.string().nullable(), // '2 x $3.000', 'Club Unimarc', etc.
    memberPrice: z.number().nullable(), // precio con tarjeta/club
    inStock: z.boolean().nullable(),
    imageUrl: z.string().nullable(),
    productUrl: z.string(),
    fetchedAt: z.string(), // ISO timestamp
  });
  ```
- Rate limiting: máximo 1 request por segundo por dominio, con jitter. Cache de 15 minutos por query. Esto mantiene el tráfico a ritmo humano.
- Errores: si un adaptador falla, las tools multi-tienda devuelven resultados parciales con una nota por tienda caída, nunca un error total.

---

## 4. Tools MCP (v1)

| Tool              | Parámetros                                                                  | Descripción                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `search_products` | `query`, `stores?`, `limit?`, `sort?`                                       | Busca en una o varias cadenas. Default: todas las disponibles.                                                                |
| `compare_prices`  | `query`, `stores?`                                                          | Busca en todas, matchea productos equivalentes (marca + formato) y devuelve tabla comparativa con precio y precio por unidad. |
| `get_offers`      | `store`, `category?`                                                        | Productos con descuento activo.                                                                                               |
| `get_product`     | `store`, `id`                                                               | Detalle de un producto.                                                                                                       |
| `build_list`      | `items: {query, quantity}[]`, `optimize?: 'single_store' \| 'cheapest_mix'` | Arma lista de compra: mejor tienda única o mix más barato, con total estimado por escenario.                                  |
| `adapter_status`  | —                                                                           | Diagnóstico: qué cadenas responden ahora.                                                                                     |

Notas de diseño para el matching de `compare_prices`: normalizar texto (tildes, mayúsculas), extraer formato con regex (`1 kg`, `1 lt`, `x12`), comparar por precio por unidad cuando el formato difiere. No pretender matching perfecto en v1: devolver candidatos con score y dejar el juicio al LLM, es su fortaleza.

---

## 5. Roadmap por fases

**Fase 0 — Esqueleto (medio día)**
Monorepo, SDK MCP, schema zod, tool `adapter_status`, un adaptador dummy. Criterio de salida: el server conecta en Claude Code y responde una tool.

**Fase 1 — Cencosud (1-2 días)**
Adaptador Constructor.io para Jumbo. Extraer key de Santa Isabel y parametrizar. Mapear headers de `sm-web-api` para detalle de producto. Fixtures + tests. Criterio de salida: `search_products` y `compare_prices` funcionando entre Jumbo y Santa Isabel.

**Fase 2 — Tottus y Unimarc (2-3 días)**
Tottus: fetch SSR + parser `__NEXT_DATA__`. Unimarc: probar APIs VTEX desde IP residencial; si fallan, Playwright. Criterio de salida: comparación a 4 cadenas.

**Fase 3 — Lider (2-4 días, el difícil)**
Playwright con contexto persistente, intercepción de respuestas GraphQL de búsqueda. Manejo de PerimeterX: si bloquea headless, modo headed con perfil del usuario. Criterio de salida: búsqueda Lider estable en 8 de 10 intentos consecutivos.

**Fase 4 — Carro Jumbo con sesión (post-lanzamiento)**
Login manual del usuario en ventana Playwright (nunca captura de credenciales), cookies en perfil local, tools `add_to_cart`, `get_cart`, `get_frequent_purchases`. Solo Jumbo primero: es tu caso de uso y sirve de piloto.

**Fase 5 — Lanzamiento open source**
README con GIF de demo, licencia MIT, disclaimer legal, publicación npm, post de lanzamiento. Considerar dominio propio del proyecto y submission al MCP Registry.

---

## 6. Testing y verificación

- Unit tests con fixtures JSON grabadas de cada API (sin red). Corren en CI.
- Live smoke tests (`npm run test:live`): una búsqueda real por cadena, validan solo el schema, no valores. Corren manualmente o en cron semanal para detectar cambios de endpoint.
- `adapter_status` expone la misma verificación en runtime al usuario.
- Regla de mantenimiento: cada adaptador declara `lastVerified` y el README publica una tabla de estado.

## 7. Riesgos y mitigaciones

| Riesgo                           | Mitigación                                                              |
| -------------------------------- | ----------------------------------------------------------------------- |
| ToS prohíben acceso automatizado | Proyecto local por usuario, a ritmo humano, sin redistribución de datos |
