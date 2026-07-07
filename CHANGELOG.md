# Changelog

Todas las versiones notables de `mcp-supermercados-cl`. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
[SemVer](https://semver.org/lang/es/).

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

[1.1.0]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.1.0
[1.0.3]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.0.3
[1.0.2]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.0.2
[1.0.1]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.0.1
[1.0.0]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.0.0
