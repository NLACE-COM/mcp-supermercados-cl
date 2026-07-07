# mcp-supermercados-cl

Servidor MCP para armar la mejor lista de compra dentro de un supermercado
chileno, empezando por Jumbo. El foco es profundidad en la cadena donde el
usuario ya compra (precios club, beneficios por RUT, historial), no la
comparación entre cadenas.

**Estado: Fase 1 completa · Fase 3 parcial (versión pública de `build_list`/`suggest_swaps`).**

| Fase | Alcance | Estado |
|---|---|---|
| 1 | Jumbo lectura pública (`search_products`, `get_product`, `get_offers`) | ✅ completa |
| 2 | Jumbo con sesión: precio club, frecuentes, listas guardadas | pendiente (requiere login del usuario) |
| 3 | `build_list`, `suggest_swaps`, carro | `build_list`+`suggest_swaps` públicos ✅ · integración con historial y carro pendientes |
| 4 | Santa Isabel (mismo adaptador Cencosud) | pendiente |
| 5-7 | Unimarc, Tottus, Lider, `compare_stores` | pendiente |

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

O en desarrollo: `npm run inspector` (MCP Inspector) / `npm run dev`.

## Tools

- `build_list` — convierte una lista en lenguaje natural en productos
  concretos: mejor precio por unidad + ofertas, con alternativas por ítem,
  total estimado y ahorro. (Con sesión, fase 2, priorizará tus frecuentes.)
- `suggest_swaps` — reemplazos comparables con mejor precio por unidad.
- `adapter_status` — diagnóstico en vivo de las cadenas soportadas.
- `search_products` — busca en Jumbo. Devuelve precios normalizados en CLP:
  `price` (vigente), `listPrice` (normal si hay oferta), `unitPrice`+`unit`
  (CLP por kg/lt/un), stock, y con `branchId` los precios de una sucursal.
- `get_product` — detalle por URL/slug, incluye `memberPrice` (precio
  socio Jumbo Prime, visible sin login) y EAN.
- `get_offers` — ofertas vigentes, filtrables por categoría y sucursal;
  `primeOnly` para las exclusivas de socios.

## Tests

```bash
npm test          # contrato con fixtures reales grabadas (sin red)
npm run test:live # smoke contra jumbo.cl (opt-in, valida solo esquema)
```

## Diseño

- Un servidor, un adaptador por cadena (`src/adapters/`), esquema normalizado
  con zod (`src/core/types.ts`) donde precio normal y precio socio van
  separados.
- HTTP a ritmo humano: 1 req/s por dominio con jitter, reintentos con
  backoff, user-agent realista (`src/http/client.ts`).
- 100% local: el tráfico sale de la máquina del usuario; las credenciales
  (fase 2) nunca tocan un servidor central.
- Endpoints documentados en `docs/captura-cencosud-2026-07-06.md` y en los
  planes (`PLAN-mcp-supermercados-chile.md`).
