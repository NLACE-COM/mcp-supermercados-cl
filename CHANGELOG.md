# Changelog

Todas las versiones notables de `mcp-supermercados-cl`. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
[SemVer](https://semver.org/lang/es/).

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

[1.4.0]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.4.0
[1.3.0]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.3.0
[1.2.0]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.2.0
[1.1.0]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.1.0
[1.0.3]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.0.3
[1.0.2]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.0.2
[1.0.1]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.0.1
[1.0.0]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.0.0
