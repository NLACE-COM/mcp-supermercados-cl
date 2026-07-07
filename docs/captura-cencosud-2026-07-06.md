# Captura Cencosud (Jumbo) — 2026-07-06

Captura del tráfico real de jumbo.cl con navegador + verificación server-side
con curl. Complementa y actualiza la sección 4 del plan.

## 1. Búsqueda: Constructor.io (VERIFICADO)

```
GET https://pwcdauseo-zone.cnstrc.com/search/{query}
```

| Param | Valor | Nota |
|---|---|---|
| `key` | `key_JopvNXKS61kwGkBe` | Prod jumboCL. Pública, embebida en el frontend |
| `i` | UUID v4 | Id de cliente persistente (cookie de ciojs). Cualquier UUID funciona |
| `s` | `1` | Número de sesión del cliente |
| `c` | `ciojs-2.1436.4` | Versión del cliente JS observada. Opcional |
| `page` | `1..n` | Base 1 |
| `num_results_per_page` | `1..~200` | |
| `sort_by` / `sort_order` | `relevance` / `descending` | Defaults del servidor |
| `filters[BrandName]` etc. | | Facetas: BrandName, Tipo de Producto, sellingPrice (range), etc. |
| `variations_map` | JSON (ver §2) | Precios/stock por sucursal |
| `_dt` | timestamp ms | Cache-buster del cliente oficial |

- **Headers**: basta `User-Agent` realista. Sin cookies, sin key privada.
- La página de búsqueda de jumbo.cl es **SSR**: el navegador no llama a
  Constructor al navegar; lo hace el servidor de Jumbo. El endpoint público
  responde igual a requests directos (verificado con curl, HTTP 200).
- El JS `https://cnstrc.com/js/cust/cencosud_0BmS-e.js` contiene el mapa
  completo de keys por bandera:

| Bandera | prod | qa | dev |
|---|---|---|---|
| jumboCL | `key_JopvNXKS61kwGkBe` | `key_DFB3C0u9Wbjq8StU` | `key_9NpwWxusNvJ2Cyhk` |
| sisaCL (Santa Isabel) | `key_c73M3GMIWJ8AcNnd` | — | — |
| paris | `key_8pjkPsSkEsJHKgxR` | `key_6PvQHDnR0zdWgEPh` | `key_j7ajk8vvD4T7oNEM` |
| easyCL | `key_AimxrTjorsjiKQPy` | `key_Vczly9AHgvdrtulj` | `key_tUrIQxBOU2aGAGad` |
| jumboCO | `key_MiR4ElROwyAwJxlr` | — | — |
| wongPE / metroPE | `key_FxY3WjZjKWp9ZgIy` / `key_Yz1sWCvhXgmmrPpo` | — | — |

⚠️ La key de Santa Isabel **no responde** en `pwcdauseo-zone.cnstrc.com`.
**Actualización 2026-07-07**: responde en el host estándar `ac.cnstrc.com`
con la misma forma de payload (SkuData, sellingPrice, etc.). Diferencias
encontradas para fase 4:
- Las URLs de producto apuntan a `www.sisa.cl` (redirigen a santaisabel.cl).
- La respuesta de búsqueda probada no trajo `variations[]` por tienda.
- El PDP de santaisabel.cl NO usa el estado React Query de Jumbo: embebe
  `window.__renderData` (payload VTEX con `items[].sellers[].commertialOffer`)
  y los precios vienen en **0** sin tienda seleccionada. getProduct para SI
  necesita parser propio + resolver la selección de tienda.

### Campos relevantes de cada resultado

- `value` / `data.ProductName`: nombre.
- `data.id`: SKU id. `data.ProductRefId`: referencia. `data.ProductId`: id numérico de producto.
- `data.sellingPrice`: **precio vigente** (con oferta). `data.price` / `data.listPrice` / `data.originalPrice`: precio normal.
- `data.stockLevel`: `"in-stock"` / `"out-of-stock"`; `data.outOfStock`: bool.
- `data.SkuData[0]`: **string JSON** keyed por sku id con `measurement_unit_un` (kg/lt/un), `unit_multiplier_un` (para precio por unidad), `promotionData`, `cart_limit`.
- `data.url`: URL completa de la PDP. `data.image_url`, `data.BrandName`.
- `variations[]`: una entrada por sucursal (`storeId`) con price/sellingPrice/listPrice/stockLevel locales. `storeId: "1"` = catálogo nacional (default de `data.*`).

## 2. Región / sucursal (VERIFICADO)

Los precios difieren por sucursal (ej. arroz Banquete: $1.890 nacional,
$1.790 en 39 tiendas). El scoping se hace con `variations_map` + `filter_by`
sobre `data.storeId`:

```json
{
  "group_by": [{ "name": "variation", "field": "data.variation_id" }],
  "values": {
    "price":        { "aggregation": "min",   "field": "data.price" },
    "sellingPrice": { "aggregation": "min",   "field": "data.sellingPrice" },
    "listPrice":    { "aggregation": "min",   "field": "data.listPrice" },
    "stockLevel":   { "aggregation": "first", "field": "data.stockLevel" },
    "storeId":      { "aggregation": "first", "field": "data.storeId" }
  },
  "dtype": "array",
  "filter_by": { "and": [{ "field": "data.storeId", "value": "jumboclj512" }] }
}
```

Cada resultado trae entonces `variations_map: [{...valores de esa tienda}]`
(vacío si la tienda no vende el producto). Ids de sucursal: `jumboclj4xx`–`jumboclj9xx`
(la lista aparece en `data.SellerVSS` y en "Surtido Habilitado en Tienda" de la PDP).
La web asignó por defecto `jumboclj512` en esta sesión sin elegir comuna.

## 3. Detalle de producto: PDP SSR (VERIFICADO) — aquí está el precio Prime

`GET https://www.jumbo.cl/{slug}/p` con UA realista devuelve HTML con un
**estado deshidratado de React Query** inline: JSON que comienza con
`{"mutations":[],"queries":[...]}`, query key `["pdp","{branchId}","/{slug}/p"]`.

`queries[].state.data` incluye: `productId`, `brand`, `categories`,
`specifications` (ingredientes, surtido por tienda), y `items[]` (SKUs):

- `price` (vigente), `listPrice`, `ppumPrice`/`ppumListPrice`/`ppumMeasurementUnit` (precio por unidad), `ean`, `stock`, `cartLimit`, `images`.
- `promotions[]`: cada promo con `unitPrice` y `userProperties`:
  - `"ALL"` → oferta pública (ej. $1.790),
  - `"PRIME_USER"` → **precio Jumbo Prime** (ej. $1.600), visible sin login.
- `pill`: etiqueta visual ("Oferta").

Ejemplo real (arroz Banquete 1 kg): listPrice 2440, oferta ALL 1790,
Prime 1600.

## 3b. Ofertas: browse de colecciones (VERIFICADO)

Las páginas de ofertas son browse de Constructor sobre colecciones fijas
(el SSR expone `originalUrl: "/busca?fq=H%3A<id>"`):

```
GET https://pwcdauseo-zone.cnstrc.com/browse/collection_id/30399   ← /jumbo-ofertas (≈5.100 productos)
GET https://pwcdauseo-zone.cnstrc.com/browse/collection_id/30307   ← /ofertas-prime (exclusivas socios)
```

- Mismos params que la búsqueda (`key`, `i`, `s`, `page`, `num_results_per_page`, `variations_map`).
- Filtro por categoría: `filters[group_id]={id}` (ej. `27` = Despensa). El
  árbol de categorías con sus ids viene en `response.groups` de cualquier
  respuesta de búsqueda/browse.
- `browse/group_id/{id}` también funciona para navegar una categoría completa.
- Ojo: la colección puede incluir promos que no bajan `sellingPrice` (ej. "2x").

## 4. sm-web-api.ecomm.cencosud.com

- `GET /catalog/api/v1/reviews/ratings?ids=...` → **200 público** (lo llama el navegador client-side).
- `GET /catalog/api/v{1,2,4}/product(s)/{slug}` → **401**: exige api key que
  no está en los bundles públicos revisados. Pendiente: capturarla en fase 2
  desde una sesión logueada (o seguir usando el SSR de la PDP, que basta).

## 4b. Sesión y área autenticada (fase 2, capturado 2026-07-07)

Con sesión iniciada del usuario (sin que el MCP toque credenciales):

- **Dónde vive la sesión**: el token de autenticación está en el
  **localStorage** del sitio (`sessionDataToken`, `userData`,
  `refreshTokenEmail`), además de cookies. Consecuencia: exportar cookies NO
  basta; hay que operar el navegador ya logueado. Vía de producción:
  Playwright con el perfil de Chrome del usuario (opción 1 del plan).
- **Backend autenticado**: `be-reg-groceries-bff-jumbo.ecomm.cencosud.com`
  y rutas `user/api/v1/*` de `sm-web-api`, con headers `token` /
  `Authorization` / `apiKey` / `x-consumer` / `x-account`.
- **Productos frecuentes**: `https://www.jumbo.cl/productos-frecuentes` es un
  shell client-side; los productos se renderizan en el DOM como cards con
  `data-cnstrc-item-id` / `-name` / `-price` y `href` a la PDP. Cada card
  trae en texto: precio vigente, precio tachado (`.line-through`), precio por
  unidad (`.ppum-price-container`) y **badge "Paga $X" = precio Prime**.
- **Precio Prime confirmado** (ej. usuario): Salame $1.472 (oferta, 20% dcto)
  / normal $1.840 / **Prime $1.288**. El parser (`adapters/cencosudSession.ts`)
  usa `data-cnstrc-item-price` para el vigente (el nodo visible a veces trae
  vigente+tachado pegados) y "Paga $X" para `memberPrice`.
- **Puente de sesión**: `adapters/session.ts` define `BrowserBridge`
  (`fetchAuthedHtml`) y `dataSession` (cards ya extraídas). La tool
  `get_frequent_purchases` recibe las cards del navegador del usuario; el
  servidor nunca ve el token.

## 4d. Santa Isabel: detalle y listas (mejoras, 2026-07-07)

**Detalle** (equivalente a la PDP de Jumbo, distinto transporte):
```
POST https://bff.santaisabel.cl/catalog/pdp
apiKey: be-reg-groceries-sisa-catalog-wdhhq5a2fken   (pública, del frontend)
x-client-platform: web
x-client-version: 2.3.17
x-trace-id: <uuid por request>
body: {"slug":"{slug}","store":"{sucursal}"}   (ej. store "pedrofontova")
```
La respuesta trae `items[]` con la **misma forma que Jumbo** (`price`,
`listPrice`, `ppumPrice`, `ppumMeasurementUnit`, `ean`, `stock`,
`promotions[]` con `userProperties` para el precio socio). Acepta el slug con
id numérico de las URLs de Constructor (ej.
`leche-entera-surlat-b-a-1l-1991554`). `store` = sucursal (branchId); sin ella
usa la del default. Por eso el `CencosudBannerConfig` gana `pdpStyle:"bff-pdp"`
y el adaptador comparte `mapPdpData` entre Jumbo (estado deshidratado) y SI.

**Listas guardadas de Jumbo** (fase 2):
```
GET /lists?store={branchId}                        (listas del usuario)
GET /lists/inspiration-list?perPage=5&page=1&...   (sugeridas)
GET /lists/{scope}/{idList}?store={branchId}       (detalle con items)
```
Cada lista: `{idList, name, description, items[], isFavorite}`. Cada item:
`{idItem, name, price, listPrice, quantity, promotions[], stock,
measurementUnit, unitMultiplier}` — el precio socio en `promotions[]` con
userProperties PRIME_USER, igual que carro/PDP. Requiere sesión (token en
localStorage): el navegador entrega el JSON, el server lo normaliza
(`adapters/cencosudLists.ts`, tool `get_saved_lists`).

## 4c. Carro (fase 3, capturado 2026-07-07)

Endpoints del BFF `be-reg-groceries-bff-jumbo.ecomm.cencosud.com`:

```
GET   /cart?store={branchId}&simulationTotals=true   → estado del carro
PATCH /cart/items                                     → agregar/actualizar
```

- **Headers** (autenticados): `token` / `Authorization`, `apiKey`, `x-consumer`,
  `x-e-commerce`, `x-account`. El token viene del localStorage → operar desde
  el navegador del usuario.
- **Body de PATCH /cart/items** (verificado):
  ```json
  {"items":[{"skuId":"92628","quantity":3,"isUnitary":false,"giftable":false,
    "itemQuantityLimit":18,"isUnitaryEligible":false,"sponsoredId":null,
    "measurementUnitUn":"kg","unitMultiplierUn":1,"soldBy":"Jumbo"}],
   "store":"jumboclj512"}
  ```
  quantity=0 (o el botón basurero en la UI) elimina la línea.
- **Respuesta de GET /cart**: `{ items[], itemsQuantity, totals, simulation }`.
  - `items[].prices`: `{listPrice, totalListPrice, price, totalPrice}`.
  - `items[].promotions[]`: cada una con `userProperties` ("ALL" | "PRIME_USER")
    y `applied`. El precio socio de la línea es la promo PRIME_USER.
  - `totals`: `{subTotal, total, itemDiscounts:{value, details:[{key,value}]}, shipping}`.
    Los `details` separan el descuento "ALL" del "PRIME_USER".
  - `simulation`: totales por medio de pago (`DEBIT_CARD`, `CENCOSUD_CARD`,
    `CENCOPAY_BALANCE`), cada uno con su `discountDetails.details` {ALL, PRIME_USER}.
- El adaptador (`adapters/cencosudCart.ts`) normaliza a `Cart` exponiendo
  `total`, `savings` y `primeSavings` (ahorro atribuible al beneficio socio).
  Las tools `add_to_cart`/`get_cart` no ejecutan la llamada (el server no ve
  el token): arman el request y normalizan el JSON que devuelve el navegador.

## 5. Implicancias para el adaptador

1. Búsqueda: Constructor.io directo, sin navegador. `sellingPrice` como
   `price`, `listPrice` solo si hay descuento real.
2. Sucursal: parámetro `branchId` → `variations_map.filter_by`.
3. `memberPrice` (Prime) no viene en la búsqueda; se obtiene con
   `getProduct` (fetch de la PDP + parseo del estado deshidratado).
4. Santa Isabel: mismo adaptador, falta host de zona + verificar su PDP.
