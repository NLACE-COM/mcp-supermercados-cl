# Changelog

Todas las versiones notables de `mcp-supermercados-cl`. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
[SemVer](https://semver.org/lang/es/).

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

[1.0.3]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.0.3
[1.0.2]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.0.2
[1.0.1]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.0.1
[1.0.0]: https://github.com/NLACE-COM/mcp-supermercados-cl/releases/tag/v1.0.0
