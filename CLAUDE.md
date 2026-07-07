# CLAUDE.md — mcp-supermercados-cl

Servidor MCP en TypeScript para armar la mejor lista de compra en
supermercados chilenos. Foco: profundidad en UNA cadena con la sesión y
beneficios por RUT del usuario (Jumbo primero), no comparación entre cadenas.

## Documentos fuente

- `PLAN-mcp-supermercados-chile.md` — plan vigente (arquitectura, roadmap por fases, tools). **Fuente de verdad.**
- `PLAN-supermercado-mcp.md` — plan anterior orientado a comparación; útil solo como referencia de endpoints.
- `docs/captura-cencosud-2026-07-06.md` — captura verificada del request de Constructor.io, scoping por sucursal (`variations_map`), y dónde vive el precio Prime (estado deshidratado del SSR de la PDP).

## Estado (actualizar al avanzar)

- **Fase 1 completa** (2026-07-06): tools `search_products`, `get_product` y `get_offers` funcionando contra Jumbo con tests de contrato (fixtures reales) y smoke live. `get_product` es la fuente del precio Prime (`memberPrice`).
- **Fase 3 parcial** (2026-07-07): `build_list` y `suggest_swaps` públicos (ranking por precio por unidad + ofertas, lógica en `src/core/listBuilder.ts`), `adapter_status`, cache TTL 15 min en el adaptador (`src/core/cache.ts`). Falta: priorizar frecuentes (depende de fase 2) y carro.
- **Fase 2 (frecuentes + precio Prime) completa** (2026-07-07): `get_frequent_purchases` y `get_member_price` implementadas. Captura clave: el token de Jumbo vive en **localStorage** (no solo cookies), así que la sesión se opera desde el navegador del usuario. `build_list` ahora prioriza frecuentes (`matchFrequent` en listBuilder). Parser en `src/adapters/cencosudSession.ts`, puente en `src/adapters/session.ts`, fixture real en `tests/fixtures/frequent-products-2026-07-07.json`. Pendiente fase 2: listas guardadas.
- Modelo de sesión: el servidor nunca ve credenciales. El cliente (junto al navegador logueado) entrega las cards del DOM de /productos-frecuentes vía el parámetro `cards`/`frequentCards`. Vía de producción para automatizarlo: Playwright con perfil de Chrome (`BrowserBridge.fetchAuthedHtml`).
- **Fase 3 (carro) completa** (2026-07-07): `add_to_cart` y `get_cart`. Endpoints del BFF verificados con la sesión del usuario: `GET /cart?store={branchId}&simulationTotals=true` y `PATCH /cart/items` (body con skuId+quantity+banderas). Parser en `src/adapters/cencosudCart.ts`, tools en `src/tools/cart.ts`, fixture real en `tests/fixtures/cart-2026-07-07.json`. El `Cart` normalizado expone `total`, `savings` y `primeSavings` (el ahorro socio sale de `totals.itemDiscounts.details` / `simulation.*.discountDetails`, clave PRIME_USER). Las tools no ejecutan la llamada (el server no ve el token): arman el request y normalizan el JSON que devuelve el navegador. `add_to_cart` es reversible; no es compra.
- Con esto Jumbo tiene el ciclo completo del plan (fases 1-3). Pendientes: listas guardadas (fase 2), Santa Isabel (fase 4, recon hecho), Unimarc/Tottus/Lider (5-6), compare_stores (7).
- **Fase 4 (Santa Isabel) — búsqueda habilitada** (2026-07-07): registrada con `SANTA_ISABEL_CONFIG` (host `ac.cnstrc.com`, key `key_c73M3GMIWJ8AcNnd`). `search_products`, `build_list` y `suggest_swaps` funcionan para `santaisabel` con precios y ofertas reales. El `CencosudBannerConfig` ahora lleva capacidades por banner (`offersCollectionId`, `pdpStyle`): `get_product` y `get_offers` de Santa Isabel lanzan error claro (su PDP `window.__renderData`/VTEX y ofertas requieren comuna seleccionada; precios en 0 sin ella). URLs de producto en www.sisa.cl. Fixture: `tests/fixtures/santaisabel-search-arroz.json`. Pendiente para profundidad completa en SI: parser VTEX con selección de comuna → precio socio y carro.

## Convenciones

- Precios SIEMPRE en CLP enteros. `price` = vigente público, `listPrice` = normal si hay descuento, `memberPrice` = socio (Prime/club) separado. No mezclar.
- `branchId` = sucursal dentro de la cadena (ej. `jumboclj512`); `store`/`StoreId` = la cadena (`jumbo`, `santaisabel`, ...).
- Todo HTTP pasa por `src/http/client.ts` (rate limit 1 req/s por host + jitter, reintentos, UA realista). No usar `fetch` directo en adaptadores.
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
