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
- Fase 2 (sesión/precio club, frecuentes, listas): interfaces declaradas en `src/adapters/base.ts`, lanzan `NotImplementedError`. **Bloqueada en el usuario**: se necesita su sesión iniciada en jumbo.cl (Chrome) para capturar los endpoints de frecuentes/listas/precio socio y la api key de sm-web-api que hoy da 401.
- Santa Isabel: key Constructor extraída (`key_c73M3GMIWJ8AcNnd`) pero su host de zona es distinto al de Jumbo — capturar en fase 4.

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
