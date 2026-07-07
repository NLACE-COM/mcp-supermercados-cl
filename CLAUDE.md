# CLAUDE.md — mcp-supermercados-cl

Servidor MCP en TypeScript para armar la mejor lista de compra en
supermercados chilenos. Foco: profundidad en UNA cadena con la sesión y
beneficios por RUT del usuario (Jumbo primero), no comparación entre cadenas.

## Documentos fuente

- `docs/PLAN-arquitectura.md` — plan vigente (arquitectura, roadmap por fases, tools). **Fuente de verdad.**
- `docs/PLAN-referencia-endpoints.md` — plan anterior orientado a comparación; útil solo como referencia de endpoints.
- `docs/captura-cencosud-2026-07-06.md` — captura verificada del request de Constructor.io, scoping por sucursal (`variations_map`), y dónde vive el precio Prime (estado deshidratado del SSR de la PDP).

## Estado (actualizar al avanzar)

- **Fase 1 completa** (2026-07-06): tools `search_products`, `get_product` y `get_offers` funcionando contra Jumbo con tests de contrato (fixtures reales) y smoke live. `get_product` es la fuente del precio Prime (`memberPrice`).
- **Fase 3 parcial** (2026-07-07): `build_list` y `suggest_swaps` públicos (ranking por precio por unidad + ofertas, lógica en `src/core/listBuilder.ts`), `adapter_status`, cache TTL 15 min en el adaptador (`src/core/cache.ts`). Falta: priorizar frecuentes (depende de fase 2) y carro.
- **Fase 2 (frecuentes + precio Prime) completa** (2026-07-07): `get_frequent_purchases` y `get_member_price` implementadas. Captura clave: el token de Jumbo vive en **localStorage** (no solo cookies), así que la sesión se opera desde el navegador del usuario. `build_list` ahora prioriza frecuentes (`matchFrequent` en listBuilder). Parser en `src/adapters/cencosudSession.ts`, puente en `src/adapters/session.ts`, fixture real en `tests/fixtures/frequent-products-2026-07-07.json`. Pendiente fase 2: listas guardadas.
- Modelo de sesión: el servidor nunca ve credenciales. El cliente (junto al navegador logueado) entrega las cards del DOM de /productos-frecuentes vía el parámetro `cards`/`frequentCards`. Vía de producción para automatizarlo: Playwright con perfil de Chrome (`BrowserBridge.fetchAuthedHtml`).
- **Fase 3 (carro) completa** (2026-07-07): `add_to_cart` y `get_cart`. Endpoints del BFF verificados con la sesión del usuario: `GET /cart?store={branchId}&simulationTotals=true` y `PATCH /cart/items` (body con skuId+quantity+banderas). Parser en `src/adapters/cencosudCart.ts`, tools en `src/tools/cart.ts`, fixture real en `tests/fixtures/cart-2026-07-07.json`. El `Cart` normalizado expone `total`, `savings` y `primeSavings` (el ahorro socio sale de `totals.itemDiscounts.details` / `simulation.*.discountDetails`, clave PRIME_USER). Las tools no ejecutan la llamada (el server no ve el token): arman el request y normalizan el JSON que devuelve el navegador. `add_to_cart` es reversible; no es compra.
- **Fases 5-7 completas** (2026-07-07): las cinco cadenas del plan y `compare_stores`.
  - Unimarc (`src/adapters/unimarc.ts`): `POST bff-unimarc-ecommerce.unimarc.cl/catalog/product/search`. Precio socio "Club Unimarc" en `priceDetail.promotionalTag`.
  - Tottus (`src/adapters/tottus.ts`): SSR `__NEXT_DATA__` de `/tottus-cl/buscar?Ntt=`. Precios string; `internetPrice`/`normalPrice`/`pum`.
  - Lider (`src/adapters/lider.ts`): SSR `__NEXT_DATA__` de `/search?query=` (nodos `__typename:Product`). Sin bloqueo PerimeterX en IP residencial; soporta puente de navegador (`session.fetchAuthedHtml`) como fallback.
  - `compare_stores` (`src/core/compare.ts` + `src/tools/compareStores.ts`): total de la lista por cadena, marca la más barata; resultados parciales si una cadena falla.
  - HttpClient ganó `postJson` (Unimarc). Helpers `parseClpString`/`parseUnitPriceString`/`normalizeUnit` en normalize.ts.
  - Unimarc/Tottus/Lider requieren IP residencial (datacenter bloquea); documentado en `docs/captura-otras-cadenas-2026-07-07.md`. Fixtures reales en tests/fixtures.
  - Publicación: LICENSE MIT, README de lanzamiento con aviso legal. Server v1.0.0, 10 tools, 72 tests de contrato.
- **Tres mejoras completas** (2026-07-07):
  1. Listas guardadas de Jumbo: `get_saved_lists` + `adapters/cencosudLists.ts`. Endpoints `/lists`, `/lists/{scope}/{idList}`. Items con misma forma que carro (precio socio en promotions PRIME_USER). Fixture `jumbo-list-2026-07-07.json`.
  2. Profundidad no-Jumbo: Santa Isabel ganó `get_product` con precio socio; su carro usa el `addToCart`/`getCart` genérico del CencosudAdapter (mismo BFF). Unimarc/Tottus/Lider: carro con login propio, fase futura.
  3. Detalle de Santa Isabel: `pdpStyle:"bff-pdp"` → `POST bff.santaisabel.cl/catalog/pdp` con `{slug, store}` + headers (apiKey pública `be-reg-groceries-sisa-catalog-wdhhq5a2fken`, x-client-version 2.3.17). Misma forma de item que Jumbo; `mapPdpData` compartido. `store` = sucursal (default "pedrofontova", override con branchId). Fixture `santaisabel-pdp.json`.
- 12 tools, 80 tests de contrato. Detalle en docs/captura-cencosud-2026-07-06.md §4d.
- **Fase 4 (Santa Isabel) — búsqueda habilitada** (2026-07-07): registrada con `SANTA_ISABEL_CONFIG` (host `ac.cnstrc.com`, key `key_c73M3GMIWJ8AcNnd`). `search_products`, `build_list` y `suggest_swaps` funcionan para `santaisabel` con precios y ofertas reales. El `CencosudBannerConfig` ahora lleva capacidades por banner (`offersCollectionId`, `pdpStyle`): `get_product` y `get_offers` de Santa Isabel lanzan error claro (su PDP `window.__renderData`/VTEX y ofertas requieren comuna seleccionada; precios en 0 sin ella). URLs de producto en www.sisa.cl. Fixture: `tests/fixtures/santaisabel-search-arroz.json`. Pendiente para profundidad completa en SI: parser VTEX con selección de comuna → precio socio y carro.

## Convenciones

- Precios SIEMPRE en CLP enteros. `price` = vigente público, `listPrice` = normal si hay descuento, `memberPrice` = socio (Prime/club) separado. No mezclar.
- `branchId` = sucursal dentro de la cadena (ej. `jumboclj512`); `store`/`StoreId` = la cadena (`jumbo`, `santaisabel`, ...).
- Todo HTTP pasa por `src/http/client.ts`. Rate limit por host diferenciado: hosts de API (Constructor.io, BFF Cencosud/Unimarc/Santa Isabel) a ~350 ms (`fastHostSuffixes`), sitios SSR (www.*, super.lider.cl) a ~1 s. Fallar rápido: 1 reintento, timeout 8 s. Ajustable por entorno: `SUPERMERCADOS_MIN_DELAY_MS`, `SUPERMERCADOS_FAST_DELAY_MS`, `SUPERMERCADOS_TIMEOUT_MS`, `SUPERMERCADOS_MAX_RETRIES`. No usar `fetch` directo en adaptadores.
- Feedback: `build_list` y `compare_stores` emiten `notifications/progress` MCP (ver `src/tools/progress.ts`) si el cliente manda `progressToken`. `compare_stores` corta cada cadena a 25 s (`STORE_BUDGET_MS`) y devuelve parcial en vez de bloquear a las demás.
- La versión del server MCP sale de `package.json` (`src/server.ts`), no hardcodeada.
- Matching query→producto en español: `src/core/matching.ts` (plurales, tildes, sinónimos/regionalismos chilenos). Lo usan `matchFrequent` (listBuilder) y el filtro de relevancia de `compare_stores`. Sinónimos de una palabra en `SYNONYM_GROUPS`; multi-palabra en `PHRASE_CANON`.
- Flujo de sesión: las tools de sesión devuelven un `browserSnippet` (helpers en `src/adapters/cencosudBrowser.ts`) para ejecutar en el navegador logueado; no scrapear React/DOM a mano. Puente automatizado opcional en `src/adapters/playwrightBridge.ts` (Playwright por import dinámico, no es dependencia).
- Calidad: CI en `.github/workflows/ci.yml` (lint+typecheck+build+test, Node 20/22). ESLint flat (`eslint.config.js`) + Prettier (`.prettierrc.json`). Correr `npm run lint && npm run format:check && npm run typecheck` antes de commitear.
- UX: `instructions` del server + prompts guiados (`src/prompts.ts`: armar_lista, conectar_sesion, comparar_carro, ofertas_frecuentes). `discover_branch` (tool) lee la sucursal del navegador (`delivery-method-state`). Errores accionables en `src/core/errors.ts` (`toolError`/`toActionableError`, campo `action`). Formato CLP en `src/core/format.ts`. `build_list` acepta `maxBudget` (ajuste por presupuesto en `applyBudget`, respeta frecuentes) y devuelve `summary` formateado.
- Adaptadores aislados por cadena; un cambio de sitio rompe un adaptador, no todo. Tests de contrato con fixtures reales en `tests/fixtures/` (regrabar cuando cambie el formato, anotando fecha).
- La sesión es parámetro de primera clase (`Session`), el servidor MCP nunca ve credenciales.
- Comentarios y strings de cara al usuario en español; identificadores en inglés.

## Comandos

```bash
npm test          # contrato (sin red)
npm run test:live # smoke real contra jumbo.cl
npm run dev       # servidor por stdio
npm run inspector # MCP Inspector
```
