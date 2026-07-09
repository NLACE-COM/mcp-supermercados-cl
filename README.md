[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/nlace-com-mcp-supermercados-cl-badge.png)](https://mseep.ai/app/nlace-com-mcp-supermercados-cl)

# 🛒 mcp-supermercados-cl

> Servidor **MCP** para buscar productos, comparar precios y armar la mejor lista
> de compra en supermercados chilenos con Claude, ChatGPT u otro cliente MCP.

[![npm](https://img.shields.io/npm/v/mcp-supermercados-cl?logo=npm)](https://www.npmjs.com/package/mcp-supermercados-cl)
![node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)
![tests](https://img.shields.io/badge/tests-132%20passing-brightgreen)
![license](https://img.shields.io/badge/licencia-MIT-blue)

El foco es **profundidad en la cadena donde tú ya compras** — precios club,
beneficios por RUT, productos frecuentes, carro — con la comparación entre
cadenas como capacidad secundaria. Cubre las cinco grandes cadenas del país.

100 % local: el tráfico sale de **tu** máquina, a ritmo humano, y tus
credenciales nunca tocan un servidor central.

---

## Tabla de contenidos

- [¿Se deploya? (importante)](#-se-deploya-en-vercelaws-no)
- [Instalación](#-instalación)
- [Cobertura por cadena](#-cobertura-por-cadena)
- [Tools disponibles](#-tools-disponibles)
- [Cómo funciona la sesión](#-cómo-funciona-la-sesión-sin-credenciales-en-el-servidor)
- [Desarrollo y tests](#-desarrollo-y-tests)
- [Arquitectura](#-arquitectura)
- [Cómo contribuir](#-cómo-contribuir)
- [Aviso legal](#-aviso-legal)
- [Licencia](#-licencia)

---

## 🚫 ¿Se deploya en Vercel/AWS? No

**Este MCP no tiene URL de producción y no se deploya en ningún servidor.** Es
intencional, y es la razón por la que funciona:

- Usa transporte **stdio** (local), no HTTP. Corre en tu máquina, junto a tu
  cliente MCP (Claude Desktop, Claude Code, Cursor, ChatGPT Desktop).
- Unimarc, Tottus y Lider **bloquean el tráfico de datacenter** (antibots). Un
  deploy en la nube **no funcionaría** para esas cadenas: necesitan tu IP
  residencial.
- El precio socio, tus frecuentes y el carro viven en **tu navegador logueado**.
  Las credenciales no deben tocar un servidor central — eso además evita el
  mayor riesgo legal (un servicio que scrapee cuentas ajenas).

La forma de "producción" de un MCP como este es **instalarlo local** (vía `npx`
o clonando el repo) y conectarlo a tu cliente. Igual que la mayoría de los MCP
servers.

---

## 📦 Instalación

Requiere **Node.js ≥ 20**. Publicado en npm:
[`mcp-supermercados-cl`](https://www.npmjs.com/package/mcp-supermercados-cl).

**Opción 1 — vía `npx` (recomendada).** No instalas nada; tu cliente MCP lo
ejecuta al vuelo. En **Claude Desktop** / **Claude Code**
(`claude_desktop_config.json` o `.mcp.json`):

```json
{
  "mcpServers": {
    "supermercados": {
      "command": "npx",
      "args": ["-y", "mcp-supermercados-cl"]
    }
  }
}
```

**Opción 2 — desde el código (para desarrollar o contribuir):**

```bash
git clone https://github.com/NLACE-COM/mcp-supermercados-cl.git
cd mcp-supermercados-cl
npm install
npm run build
```

Y apunta tu cliente al build local:

```json
{
  "mcpServers": {
    "supermercados": {
      "command": "node",
      "args": ["/ruta/absoluta/al/repo/dist/index.js"]
    }
  }
}
```

Para desarrollo rápido:

```bash
npm run dev        # servidor por stdio con tsx
npm run inspector  # abre el MCP Inspector
```

---

## 🏬 Cobertura por cadena

| Cadena           | Plataforma                | Búsqueda |  Precio socio   | Detalle |        Sesión / carro        |
| ---------------- | ------------------------- | :------: | :-------------: | :-----: | :--------------------------: |
| **Jumbo**        | Cencosud (Constructor.io) |    ✅    |    ✅ Prime     |   ✅    | ✅ frecuentes, listas, carro |
| **Santa Isabel** | Cencosud (Constructor.io) |    ✅    |       ✅        |   ✅    |       carro Cencosud¹        |
| **Unimarc**      | VTEX (BFF propio)         |    ✅    | ✅ Club Unimarc |    —    |              —               |
| **Tottus**       | Falabella (Next.js SSR)   |    ✅    |        —        |    —    |              —               |
| **Lider**        | Walmart Glass (SSR)       |    ✅    |       —²        |    —    |              —               |

¹ El carro de Santa Isabel reutiliza el mismo BFF Cencosud que Jumbo; se activa
con tu sesión en santaisabel.cl.
² Lider no expone precio socio dual como el Prime de Jumbo; sus descuentos son
rebajas directas ("Precio Lider") + bundles.

> ⚠️ Unimarc, Tottus y Lider requieren **IP residencial** (tu máquina); desde
> datacenter bloquean. Como el MCP corre local, en tu equipo funcionan.

Todos los resultados vienen **enriquecidos**: nombre, marca, descripción, foto,
precio vigente, precio normal, precio socio, **precio por unidad normalizado**
(por kg/lt para comparar formatos) y **bundles** ("2 x $2.000", "Lleva 8 por $X").

---

## 🧰 Tools disponibles

**Núcleo — armar la mejor lista con tu sesión:**

| Tool                       | Qué hace                                                                                                                                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build_list`               | Convierte una lista en lenguaje natural en productos concretos. Prioriza tus frecuentes, mejor precio por unidad y ofertas. Flags `onlyOffers` / `onlyInStock` y `maxBudget` (ajusta a alternativas más baratas para caber). Incluye resumen formateado. |
| `suggest_swaps`            | Reemplazos convenientes por precio por unidad. Con `preferNatural`: alternativas de precio similar con menos ingredientes.                                                                                                                               |
| `get_frequent_purchases`   | Tus productos habituales, con precio Prime (requiere sesión).                                                                                                                                                                                            |
| `get_saved_lists`          | Tus listas guardadas (requiere sesión).                                                                                                                                                                                                                  |
| `add_to_cart` / `get_cart` | Deja la lista en el carro de Jumbo; total, ahorro y ahorro Prime.                                                                                                                                                                                        |

**Lectura de catálogo:**

| Tool                 | Qué hace                                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `search_products`    | Busca en cualquier cadena. Filtros `maxPrice`/`minPrice`/`inStockOnly`, orden `sortBy` (price / unitPrice). |
| `get_product`        | Detalle por URL/slug: precio socio, EAN, **ingredientes** y sellos nutricionales.                           |
| `get_offers`         | Ofertas vigentes de Jumbo; `primeOnly`, filtro por categoría.                                               |
| `find_opportunities` | Mayores descuentos con stock, ordenados por `discountPct`. `excludeIds` para destacar lo que no tienes.     |

**Comparación y diagnóstico:**

| Tool              | Qué hace                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `compare_stores`  | Total de una lista en varias cadenas; marca la más barata y advierte si compara formatos distintos. |
| `discover_branch` | Descubre tu sucursal (branchId) leyéndola del navegador, para no pedírtela a mano.                  |
| `adapter_status`  | Qué cadenas responden ahora y con qué latencia.                                                     |

### 💬 Prompts guiados

Para no adivinar qué pedir, el servidor expone plantillas que tu cliente MCP
muestra como sugerencias: **`armar_lista`** (con presupuesto opcional),
**`conectar_sesion`**, **`comparar_carro`** y **`ofertas_frecuentes`**. El
servidor además trae `instructions` para que el modelo te guíe en el primer uso
(qué cadena, cuándo pedir sesión, cómo leer los errores).

Los errores vienen **accionables**: cada uno trae un campo `action` con el
siguiente paso concreto (re-loguearte, reintentar, usar IP residencial…) en vez
de un mensaje técnico.

---

## 🔐 Cómo funciona la sesión (sin credenciales en el servidor)

El precio socio, los frecuentes y el carro viven detrás del login. En Jumbo, el
token vive en el `localStorage` del navegador, así que **el servidor nunca ve
credenciales**: el cliente (junto a tu navegador logueado) extrae los datos del
DOM o ejecuta las llamadas autenticadas, y el MCP solo normaliza el resultado.

Ver [`src/adapters/session.ts`](src/adapters/session.ts) y
[`docs/captura-cencosud-2026-07-06.md`](docs/captura-cencosud-2026-07-06.md).

### ¿Y esas API keys que aparecen en el código?

Verás claves como `key_JopvNXKS61kwGkBe` (Jumbo) o
`be-reg-groceries-sisa-catalog-wdhhq5a2fken` (Santa Isabel) en los adaptadores.
**No son secretos.** Son las claves **públicas del frontend** de Constructor.io
y del BFF de catálogo: van embebidas en el JavaScript de jumbo.cl y
santaisabel.cl, y son visibles en las DevTools de cualquier visitante. Solo
identifican el índice de búsqueda del lado cliente — **no dan acceso a ninguna
cuenta ni permiten escribir**. Sin ellas, el buscador no responde.

Los datos que **sí** son sensibles (token de sesión, precio socio, carro) viven
en tu navegador logueado y **nunca** están en este repositorio. Un escáner
automático puede marcar estas claves públicas como "token expuesto"; es un
falso positivo.

---

## 🧪 Desarrollo y tests

```bash
npm test           # tests de contrato con fixtures reales (sin red) — 132 tests
npm run test:live  # smoke contra los sitios reales (opt-in, LIVE=1)
npm run typecheck  # tsc --noEmit
npm run lint       # ESLint
npm run format     # Prettier (--write); format:check para verificar
```

Los tests de contrato usan respuestas reales grabadas en
[`tests/fixtures/`](tests/fixtures). Los live requieren red y, para
Unimarc/Tottus/Lider, IP residencial. Regraba una fixture cuando una cadena
cambie su formato, anotando la fecha.

Cada push y PR corre `lint + typecheck + build + test` en CI (GitHub Actions,
Node 20 y 22). Un smoke live semanal avisa por issue si una cadena cambia su
formato. Para contribuir, revisa [CONTRIBUTING.md](CONTRIBUTING.md).

### Flujo de sesión: manual o automatizado

Las tools que requieren sesión (`get_cart`, `get_frequent_purchases`,
`get_saved_lists`, `add_to_cart`) devuelven un `browserSnippet`: un fetch de
**una sola llamada** para ejecutar en una pestaña ya logueada del sitio. Pasas
el JSON de vuelta y la tool lo normaliza — el servidor nunca ve tu token.

Para automatizarlo (sin copiar/pegar), existe un puente opcional con Playwright
(`src/adapters/playwrightBridge.ts`) que reusa el perfil de Chrome donde ya
tienes la sesión. Playwright **no** viene con el paquete (es pesado); instálalo
aparte si lo quieres:

```bash
npm install playwright
npx playwright install chromium
```

---

## 🏗 Arquitectura

- **Un servidor, un adaptador por cadena** (`src/adapters/`). Esquema
  normalizado con zod (`src/core/types.ts`): precio normal y precio socio
  **separados**, precio por unidad normalizado a base canónica.
- **HTTP a ritmo humano, por tipo de host**: los endpoints de API (Constructor.io
  y los BFF de Cencosud/Unimarc/Santa Isabel) van a ~350 ms; los sitios que se
  scrapean por SSR (Tottus, Lider, PDPs `www.*`) mantienen ~1 s. Reintentos con
  backoff, user-agent realista (`src/http/client.ts`). Cache TTL 15 min.
  Ajustable por entorno: `SUPERMERCADOS_MIN_DELAY_MS`, `SUPERMERCADOS_FAST_DELAY_MS`,
  `SUPERMERCADOS_TIMEOUT_MS`, `SUPERMERCADOS_MAX_RETRIES`.
- **Feedback en vivo**: `build_list` y `compare_stores` emiten notificaciones de
  progreso MCP (`notifications/progress`) si el cliente las soporta, para no
  quedar en silencio durante listas largas. `compare_stores` limita cada cadena
  a 25 s y devuelve resultado parcial en vez de bloquear a las demás.
- **Adaptadores aislados**: un cambio de sitio rompe un adaptador, no todo.
- Endpoints documentados en [`docs/`](docs) y en
  [`docs/PLAN-arquitectura.md`](docs/PLAN-arquitectura.md).

```
src/
├── index.ts            # entrada MCP (stdio)
├── server.ts           # registro de tools
├── core/               # types, registry, normalize, listBuilder, compare, ...
├── adapters/           # cencosud (Jumbo+Santa Isabel), unimarc, tottus, lider
├── tools/              # una tool MCP por archivo
└── http/               # cliente HTTP con rate limit y reintentos
```

---

## 🤝 Cómo contribuir

¡Bienvenidas las contribuciones! Este proyecto está pensado para crecer con la
comunidad. Ver [CONTRIBUTING.md](CONTRIBUTING.md).

Ideas de alto impacto:

- Carro/sesión en Unimarc, Tottus y Lider (cada una con su login propio).
- Detalle (`get_product`) para Unimarc/Tottus/Lider.
- Nuevas cadenas o farmacias.
- Mantener las fixtures al día cuando una cadena cambie su API.

Cuando una cadena cambie su formato, `npm run test:live` lo detecta.

---

## ⚖️ Aviso legal

Herramienta **personal**, de código abierto, sin backend central. Cada usuario
opera su propia cuenta desde su propia IP, a ritmo humano, sin redistribuir
datos. Revisa los Términos y Condiciones de cada cadena antes de usarla. **No
afiliado** a Cencosud, SMU, Falabella ni Walmart. Las marcas mencionadas
pertenecen a sus respectivos dueños. Úsalo bajo tu propia responsabilidad.

---

## 📄 Licencia

[MIT](LICENSE) © contribuidores de mcp-supermercados-cl
