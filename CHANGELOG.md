# Changelog

Todas las versiones notables de `mcp-supermercados-cl`. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
[SemVer](https://semver.org/lang/es/).

## [1.4.5] - 2026-07-15

Arregla el carro de Jumbo, que fallaba en el preflight CORS desde el navegador
del usuario. Base: PR #11 de @cristiancs, más el arreglo del mismo problema en
las listas guardadas.

### Fixed

- **Carro de Jumbo**: los snippets mandaban `WnOIGTaOkfFwotM8Ddw2` como
  `apiKey` junto con `token`, `x-consumer`, `x-e-commerce` y `x-account`. Esa
  key es la del servicio `salesChannel` (VTEX legacy), no la del BFF, y esos
  cuatro headers los rechaza el preflight (el propio frontend los borra para
  los servicios del BFF). Ahora los snippets mandan `Authorization: Bearer`,
  la `apiKey` del servicio, `x-client-platform`, `x-client-version` y
  `x-trace-id`, con `credentials: "include"` (PR #11).
- **Listas guardadas**: `apiKey` **por servicio** (`JUMBO_API_KEYS` en
  `src/adapters/cencosudBrowser.ts`). Cada servicio del BFF valida la suya, así
  que `/lists` necesita `be-reg-groceries-jumbo-lists-9f222055975d` y el carro
  `be-reg-groceries-jumbo-cart-rhk68rqi0adn`. Como ambos compartían la
  constante, cambiar solo la del carro habría roto `get_saved_lists`.
  `jumboFetchSnippet`/`jumboMutateSnippet` ahora exigen el servicio como
  parámetro para que el compilador no deje repetir el error.

### Changed

- `add_to_cart` documenta que `skuId` es el campo `id` de `search_products`, no
  la referencia comercial `sku` (PR #11).
- `docs/captura-cencosud-2026-07-06.md` §4d: headers y mapa de `apiKey` por
  servicio, verificados 2026-07-15 contra el bundle público del sitio.

## [1.4.4] - 2026-07-13

Elimina el ruido del smoke live semanal: Tottus y Líder bloquean siempre el
tráfico de datacenter (GitHub Actions), así que el workflow abría un issue de
falso positivo cada lunes (ej. #9) que enterraba las alertas reales.

### Fixed

- **Smoke live tolera el bloqueo antibot esperable** (`tests/live/otras-cadenas.live.test.ts`):
  el smoke distingue un bloqueo antibot (`HttpStatusError` 401/403/307/429, o un
  `Error` con mensaje de antibot: PerimeterX/BIG-IP/"blocked") de un cambio de
  formato real (el fetch devuelve 200 pero `ProductSchema.parse` o la aserción de
  resultados falla). El bloqueo desde la nube ya no rompe el smoke —se tolera con
  un warning—, mientras que un cambio de formato sí lo rompe y abre el issue.
  Jumbo, Santa Isabel y Unimarc (Constructor.io/BFF, sin bloqueo por IP) se
  siguen validando de verdad. Se ajustó el mensaje del issue autogenerado y el
  comentario del workflow para reflejar la nueva semántica.

### Added

- Variable `SMOKE_STRICT=1`: en un runner con IP residencial reendurece el
  bloqueo a fallo, para recuperar cobertura real de las tres cadenas.
  Verificado en vivo: modo normal 7/7 (Tottus/Líder tolerados con warning),
  estricto 2 failed (Tottus/Líder).

## [1.4.3] - 2026-07-09

Corrige una condición de carrera del puente que hacía fallar cadenas cuando se
consultaban en paralelo (`compare_stores`, `build_cheapest_basket`): en la
práctica Tottus resolvía y Líder caía con "bloqueado".

### Fixed

- **Carrera al abrir el navegador** (`PlaywrightBridge.ensureContext`): las
  cadenas se navegan en paralelo, y dos `launchPersistentContext` concurrentes
  sobre el mismo `userDataDir` chocaban por el lock del perfil
  (`Target page, context or browser has been closed`) → una cadena resolvía y la
  otra fallaba de forma intermitente. Ahora se memoiza la **promesa** del
  contexto, de modo que todas las llamadas concurrentes comparten un solo
  navegador; si el lanzamiento falla, no queda cacheada la promesa rechazada.
  Verificado contra los sitios reales: Líder y Tottus resuelven juntos.

## [1.4.2] - 2026-07-09

Hace usable el puente automático cuando el server corre por **`npx`** (Claude
Desktop, etc.): antes solo cargaba Playwright si era dependencia local.

### Fixed

- **Carga de Playwright global con `npx`** (`loadPlaywright`): por `npx` el
  `node_modules` del paquete es efímero y no ve el Playwright global. `NODE_PATH`
  no ayuda —el bridge carga con `import()` (ESM) y `NODE_PATH` solo aplica a
  `require()` (CommonJS), verificado—. Ahora, si el `import("playwright")` normal
  falla, se resuelve el paquete global vía `createRequire` desde la carpeta que
  indique la nueva variable `SUPERMERCADOS_PLAYWRIGHT_PATH` (salida de
  `npm root -g` + `/playwright`). Verificado end-to-end: npx + esa variable →
  Líder 46 productos.

### Added

- Variable `SUPERMERCADOS_PLAYWRIGHT_PATH` y guía de configuración para `npx` en
  el README.

## [1.4.1] - 2026-07-09

Corrige el puente de navegador automático de la 1.4.0, que **nunca resolvía**
Líder/Tottus por tres bugs detectados al validarlo contra los sitios reales con
Playwright (los tests con fixtures no los veían). Ya verificado: Líder devuelve
~46 productos y Tottus ~48.

### Fixed

- **Extracción de `__NEXT_DATA__` robusta al `nonce` de CSP** (`src/adapters/nextData.ts`):
  el HTML traído por el navegador real inyecta `<script nonce="" id="__NEXT_DATA__" …>`
  —con el `nonce` antes del `id`—, que el marcador literal no matcheaba, así que
  Líder se reportaba como "bloqueado" pese a traer los datos. Líder y Tottus
  comparten ahora `extractNextDataJson`/`hasNextData` (tolerantes a orden de
  atributos). El fetch HTTP plano de las fixtures no lleva `nonce`, por eso el
  bug no salía en los tests.
- **`PlaywrightBridge.fetchSsrHtml` — navegación**: `waitUntil: "networkidle"`
  nunca se cumplía (estos sitios tienen analytics/polling permanente y no quedan
  idle) → timeout. Cambiado a `domcontentloaded`.
- **`PlaywrightBridge.fetchSsrHtml` — espera del selector**: `waitForSelector`
  esperaba `state: "visible"` por defecto, pero un `<script>` es invisible →
  timeout eterno. Ahora pide `state: "attached"`.
- 157 tests (incluye contrato del caso con `nonce`).

## [1.4.0] - 2026-07-09

Versión de **compra multi-cadena** y **automatización del puente de navegador**.
Integra contribuciones de la comunidad ([#3](https://github.com/NLACE-COM/mcp-supermercados-cl/pull/3)
de @dmnavalon) y cierra el [#2](https://github.com/NLACE-COM/mcp-supermercados-cl/issues/2).

### Added

- **`build_cheapest_basket`**: arma la canasta más barata "repartida". A
  diferencia de `compare_stores` (que elige UNA cadena para toda la lista),
  asigna CADA ítem a la cadena donde sale más barato (por precio por unidad) y
  agrupa la compra por cadena. Devuelve `picks`, `plan`, `basketTotal`,
  `singleStore`, `splitSaving` (ahorro de repartir vs comprar todo en una),
  `mixedFormatItems` y `missing`. Prompt guiado `super_eficiente`.
- **Puente de navegador manual para Líder y Tottus**: `search_products` acepta
  `browserHtml` (HTML o JSON de `__NEXT_DATA__` traído de un navegador real que
  ya pasó el antibot). Sin él y estando bloqueado, la tool devuelve una
  respuesta accionable (`openUrl` + `browserSnippet` + `retryWith`) en vez de un
  error seco.
- **Puente de navegador automático** (`src/adapters/browserBridge.ts`): con
  Playwright configurado por entorno (`SUPERMERCADOS_PLAYWRIGHT_PROFILE`, y
  opcionales `SUPERMERCADOS_PLAYWRIGHT_CHANNEL` / `_HEADLESS`), el servidor
  navega solo reusando el perfil de Chrome del usuario y resuelve Líder/Tottus
  sin intervención. Aplica a `search_products`, `compare_stores` y
  `build_cheapest_basket`. Sin configurar, se mantiene el flujo manual. El
  servidor sigue sin ver credenciales.

### Changed

- `PlaywrightBridge.fetchSsrHtml()` espera `#__NEXT_DATA__` en el DOM
  (`networkidle` + selector) antes de leer, porque el App Router de estas
  cadenas sirve el HTML por streaming (`self.__next_f`).
- Documentación corregida: el bloqueo de Líder es por **fingerprint del cliente**
  (TLS/JA3 + PerimeterX + F5 BIG-IP, `307 → /blocked`), no por reputación de IP;
  la nota anterior ("responde desde IP residencial") quedó obsoleta.
- 13 tools, 153 tests. README y `CLAUDE.md` actualizados.

## [1.3.0] - 2026-07-07

### Added

- **Alcance de precios por sucursal** (`priceScope` / `priceScopeNote`): las
  respuestas de `search_products`, `build_list` y `compare_stores` advierten
  cuándo los precios son de catálogo nacional (sin `branchId`) y pueden diferir
  de la sucursal del usuario.

### Fixed

- **Bloqueo de Líder detectado**: PerimeterX a veces responde `307 → /blocked`
  ("Robot or human", sin `__NEXT_DATA__`) en vez de `403`, lo que se confundía
  con "0 resultados". `isLiderBlockedHtml` lo detecta y lanza un error `blocked`
  accionable. 136 tests.

## [1.2.0] - 2026-07-07

Versión enfocada en **experiencia del usuario**.

### Added

- **Prompts guiados** (`armar_lista`, `conectar_sesion`, `comparar_carro`,
  `ofertas_frecuentes`): plantillas que el cliente MCP muestra como sugerencias,
  para que el usuario no tenga que adivinar qué pedir.
- **`instructions` del servidor**: guía al modelo sobre cómo conducir la
  conversación (qué cadena, cuándo pedir sesión, cómo leer errores).
- **`discover_branch`**: descubre la sucursal (branchId) leyéndola del navegador
  (`delivery-method-state`), para no pedirle el código técnico al usuario.
- **Presupuesto en `build_list`** (`maxBudget`): si el total se pasa, baja a
  alternativas más baratas (sin tocar tus frecuentes) y, si aún se pasa, sugiere
  qué quitar.
- **Errores accionables** (`src/core/errors.ts`): cada error trae un campo
  `action` con el siguiente paso concreto (re-login, reintentar, IP residencial)
  en vez de un mensaje técnico.
- **Resumen human-friendly** en `build_list`: totales formateados (`$12.345`),
  porcentaje de ahorro y conteo de ítems en oferta.

### Changed

- Todas las tools con errores ahora responden con el formato accionable.
- Documentación y badges actualizados. 132 tests.

## [1.1.0] - 2026-07-07

### Added

- **CI en GitHub Actions**: `lint + typecheck + build + test` en cada push/PR
  (Node 20 y 22), y un smoke live semanal que abre un issue si una cadena
  cambia de formato. Templates de issue/PR en `.github/`.
- **ESLint + Prettier** con scripts `lint`, `format`, `typecheck` y config flat.
- **Matching en español** (`src/core/matching.ts`): plurales, tildes, sinónimos
  y regionalismos chilenos (palta↔aguacate, bebida↔gaseosa, confort↔papel
  higiénico, …). `build_list` ahora encuentra frecuentes que el match literal
  perdía.
- **`compare_stores` más honesto**: filtra candidatos irrelevantes por matching,
  expone `comparability` por ítem (same/similar/mixed según EAN y unidad) y un
  `disclaimer` para no comparar formatos distintos como si fueran iguales.
- **Flujo de sesión guiado**: `get_cart`, `get_frequent_purchases`,
  `get_saved_lists` y `add_to_cart` devuelven un `browserSnippet` (fetch de una
  sola llamada) y prohíben explícitamente el scraping manual de React/DOM que
  hacía lentas estas operaciones.
- **Puente Playwright opcional** (`src/adapters/playwrightBridge.ts`) para
  automatizar el flujo de sesión reusando el perfil de Chrome logueado.
  Playwright se carga dinámicamente; no pesa en el paquete.

### Changed

- Documentación (README, `CLAUDE.md`) y badges actualizados. 119 tests.

## [1.0.3] - 2026-07-07

### Changed

- Documentación: README y `CLAUDE.md` actualizados con el rate limit por tipo de
  host, las variables de entorno de ajuste y el feedback de progreso MCP.
  Se agrega este `CHANGELOG.md`.

## [1.0.2] - 2026-07-07

### Added

- **Feedback de progreso MCP** en `build_list` (ítem a ítem) y `compare_stores`
  (cadena a cadena) vía `notifications/progress`, para no dejar al usuario en
  silencio durante operaciones largas (`src/tools/progress.ts`).
- **Presupuesto de tiempo por cadena en `compare_stores`** (25 s): una cadena
  caída o bloqueada devuelve resultado parcial en vez de bloquear a las demás.
- Variables de entorno para afinar el cliente HTTP sin recompilar:
  `SUPERMERCADOS_MIN_DELAY_MS`, `SUPERMERCADOS_FAST_DELAY_MS`,
  `SUPERMERCADOS_TIMEOUT_MS`, `SUPERMERCADOS_MAX_RETRIES`.
- Tests del cliente HTTP (rate limit diferenciado y no-reintento de 4xx).

### Changed

- **Rate limit por tipo de host**: los endpoints de API (Constructor.io y los
  BFF de Cencosud/Unimarc/Santa Isabel) pasan de ~1 s a ~350 ms; los sitios que
  se scrapean por SSR (Tottus, Lider, PDPs `www.*`) mantienen ~1 s. Un
  `build_list` típico baja de ~15 s a ~5 s.
- **Fallar rápido**: 1 reintento (antes 3) y timeout de 8 s (antes 15 s). Una
  cadena caída deja de costar hasta ~67 s.
- La versión del servidor MCP se lee de `package.json` en vez de estar fija en
  el código.

## [1.0.1] - 2026-07-07

### Fixed

- El log de arranque decía "Fase 1: Jumbo lectura pública" pese a que el
  servidor ya cubre las cinco cadenas. Ahora refleja la cobertura real.

## [1.0.0] - 2026-07-07

### Added

- Primera versión pública. 12 tools sobre cinco cadenas chilenas (Jumbo, Santa
  Isabel, Unimarc, Tottus, Lider): búsqueda, detalle, ofertas, armado de lista,
  swaps, frecuentes, listas guardadas, carro de Jumbo y comparación entre
  cadenas. Precios normal/socio separados, precio por unidad normalizado,
  bundles multi-compra. Sesión sin credenciales en el servidor. Licencia MIT.

[1.4.3]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.4.3
[1.4.2]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.4.2
[1.4.1]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.4.1
[1.4.0]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.4.0
[1.3.0]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.3.0
[1.2.0]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.2.0
[1.1.0]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.1.0
[1.0.3]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.0.3
[1.0.2]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.0.2
[1.0.1]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.0.1
[1.0.0]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.0.0
