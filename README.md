# mcp-supermercados-cl

Servidor MCP para armar la mejor lista de compra dentro de un supermercado
chileno con Claude o ChatGPT. El foco es **profundidad en la cadena donde el
usuario ya compra** — precios club, beneficios por RUT, historial — con la
comparación entre cadenas como capacidad secundaria.

100% local: el tráfico sale de la máquina del usuario, a ritmo humano, y las
credenciales nunca tocan un servidor central.

## Estado

Cinco cadenas, ciclo completo en Jumbo. Todas las fases del plan implementadas.

| Fase | Alcance | Estado |
|---|---|---|
| 1 | Jumbo lectura pública (`search_products`, `get_product`, `get_offers`) | ✅ |
| 2 | Jumbo con sesión: productos frecuentes, precio socio Prime | ✅ (listas guardadas: pendiente) |
| 3 | `build_list` (prioriza frecuentes), `suggest_swaps`, carro | ✅ |
| 4 | Santa Isabel (mismo adaptador Cencosud) | ✅ búsqueda |
| 5 | Unimarc (VTEX/BFF) y Tottus (Falabella SSR) | ✅ búsqueda |
| 6 | Lider (Walmart Glass SSR) | ✅ búsqueda |
| 7 | `compare_stores` + publicación open source | ✅ |

### Cobertura por cadena

| Cadena | Plataforma | Búsqueda | Precio socio | Detalle | Sesión / carro |
|---|---|---|---|---|---|
| Jumbo | Cencosud (Constructor.io) | ✅ | ✅ Prime | ✅ | ✅ frecuentes, listas, carro |
| Santa Isabel | Cencosud (Constructor.io) | ✅ | ✅ (detalle BFF) | ✅ | carro Cencosud¹ |
| Unimarc | VTEX (BFF propio) | ✅ | ✅ Club Unimarc | — | — |
| Tottus | Falabella (Next.js SSR) | ✅ | — | — | — |
| Lider | Walmart Glass (SSR) | ✅ | ✅ cuando aplica | — | — |

¹ El carro de Santa Isabel usa el mismo BFF Cencosud que Jumbo (`addToCart`/
`getCart` son genéricos vía el puente de sesión); se activa con la sesión del
usuario en santaisabel.cl. El carro de Unimarc/Tottus/Lider (plataformas
distintas, login propio) queda como trabajo futuro.

Unimarc, Tottus y Lider requieren **IP residencial** (la máquina del usuario);
desde datacenter bloquean. El MCP corre local, así que en producción funcionan.

## Uso

```bash
npm install
npm run build
```

En Claude Desktop / Claude Code (`.mcp.json`):

```json
{
  "mcpServers": {
    "supermercados": {
      "command": "node",
      "args": ["/ruta/al/repo/dist/index.js"]
    }
  }
}
```

En desarrollo: `npm run inspector` (MCP Inspector) o `npm run dev`.

## Tools

Núcleo — armar la mejor lista con la sesión del usuario:

- `build_list` — convierte una lista en lenguaje natural en productos
  concretos: prioriza tus **productos frecuentes** (si se pasan sus cards de
  sesión), luego mejor precio por unidad + ofertas, con alternativas por ítem,
  total estimado y ahorro.
- `suggest_swaps` — reemplazos comparables con mejor precio por unidad.
- `get_frequent_purchases` — tus productos habituales, con precio vigente,
  normal y **precio socio Jumbo Prime**. Requiere sesión: el cliente entrega
  las cards del DOM (el servidor nunca ve credenciales).
- `get_saved_lists` — tus listas de compra guardadas en Jumbo, normalizadas a
  `{ id, name, items[] }`. Requiere sesión (el cliente entrega el JSON).
- `add_to_cart` / `get_cart` — deja la lista en el carro de Jumbo y muestra el
  estado (total, ahorro y ahorro Prime). El servidor no ve credenciales: arma
  el request que ejecuta el navegador logueado del usuario.

Lectura de catálogo:

- `search_products` — busca en cualquier cadena. Precios en CLP: `price`
  (vigente), `listPrice` (normal si hay oferta), `memberPrice` (socio),
  `unitPrice`+`unit` (por kg/lt/un), `promotions` (bundles tipo "2 x $2.000"
  con precio efectivo por unidad), stock, y con `branchId` precios de sucursal.
- `get_product` — detalle por URL/slug con precio socio y EAN (Jumbo: Prime;
  Santa Isabel: vía su BFF, sucursal por defecto o con `branchId`).
- `get_offers` — ofertas vigentes de Jumbo, filtrables por categoría/sucursal;
  `primeOnly` para las exclusivas de socios.
- `find_opportunities` — las mejores oportunidades del momento: productos con
  mayor descuento y stock, ordenados por `discountPct`, con `saving` y
  `memberSaving`. `excludeIds` para destacar solo lo que no tienes en el carro;
  `minDiscountPct` para el umbral. Para recomendar ofertas que valga la pena aprovechar.

Comparación (secundaria) y diagnóstico:

- `compare_stores` — estima el total de una lista en varias cadenas y señala
  la más barata entre las que tienen todos los ítems.
- `adapter_status` — qué cadenas responden ahora y con qué latencia.

## Sesión (sin credenciales en el servidor)

El precio socio, los frecuentes y el carro viven detrás del login. El token de
Jumbo vive en el `localStorage` del navegador, así que el servidor **nunca**
ve credenciales: el cliente (junto al navegador logueado del usuario) extrae
las cards del DOM o ejecuta las llamadas autenticadas, y el MCP normaliza el
resultado. Ver `src/adapters/session.ts` y `docs/captura-cencosud-2026-07-06.md`.

## Tests

```bash
npm test          # contrato con fixtures reales grabadas (sin red), 72 tests
npm run test:live # smoke contra los sitios reales (opt-in, valida esquema)
```

Los tests de contrato usan respuestas reales grabadas en `tests/fixtures/`
(regrabar cuando una cadena cambie el formato, anotando fecha). Los live son
opt-in con `LIVE=1`; los de Unimarc/Tottus/Lider requieren IP residencial.

## Diseño

- Un servidor, un adaptador por cadena (`src/adapters/`). Esquema normalizado
  con zod (`src/core/types.ts`): precio normal y precio socio **separados**.
- HTTP a ritmo humano: 1 req/s por dominio con jitter, reintentos con backoff,
  user-agent realista (`src/http/client.ts`). Cache TTL 15 min.
- Adaptadores aislados: un cambio de sitio rompe un adaptador, no todo.
- Endpoints documentados en `docs/` y en `PLAN-mcp-supermercados-chile.md`.

## Aviso legal

Herramienta personal, de código abierto, sin backend central. Cada usuario
opera su propia cuenta desde su propia IP, a ritmo humano, sin redistribuir
datos. Revisa los Términos y Condiciones de cada cadena antes de usarla. No
afiliado a Cencosud, SMU, Falabella ni Walmart.

## Licencia

MIT — ver [LICENSE](LICENSE).
