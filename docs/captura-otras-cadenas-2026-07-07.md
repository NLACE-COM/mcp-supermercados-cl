# Captura Unimarc, Tottus y Lider — 2026-07-07

Endpoints verificados desde el navegador del usuario (IP residencial). Desde
datacenter las tres bloquean (403/400/antibots), por eso el MCP corre local.

## Unimarc (VTEX, BFF propio)

```
POST https://bff-unimarc-ecommerce.unimarc.cl/catalog/product/search
Content-Type: application/json
channel: UNIMARC          # requerido (sin estos 3 headers => 422)
source: web               # requerido
version: 1.0.0            # requerido
body: {"from":"0","to":"49","searching":"{query}","promotionsOnly":false,"orderBy":"","userTriggered":true}
```

La app también manda `session` y `anonymous` (ids generados por cliente), pero
no son necesarios: con los tres headers fijos el endpoint responde 200.

Respuesta: `availableProducts[]` (y `notAvailableProducts[]`). Por producto:
- `price.price` (vigente, string "$1.000"), `price.listPrice` (normal),
  `price.priceWithoutDiscount`, `price.inOffer`, `price.ppum` ("$2.500 x litro").
- `item`: `sku`, `name`, `brand`, `slug` ("/…/p"), `ean`, `measurementUnitUn`,
  `unitMultiplierUn`, `netContent`.
- `priceDetail.promotionalTag.text` = **"Club Unimarc"** (código C011) marca el
  precio socio; `priceDetail.discountPercentage`.

Otros endpoints observados: `POST /catalog/product/facets`,
`GET /catalog/suggestions/{q}`. URL de producto: `https://www.unimarc.cl/product{slug}`.

## Tottus (Falabella, Next.js SSR)

```
GET https://www.tottus.cl/tottus-cl/buscar?Ntt={query}
GET https://www.tottus.cl/tottus-cl/buscar?Ntt={query}&page=N&store=to_com
```

HTML con `<script id="__NEXT_DATA__">` → `props.pageProps.results` (48 por
página). Por producto: `productId`, `skuId`, `displayName`, `brand`, `url`,
`measurements.format`, y `prices[]`:
- `type:"internetPrice"` (vigente) con `pum` (precio por unidad, label KG/LT).
- `type:"normalPrice"`, `crossed:true` (precio tachado).
- `discountBadge.label` ("-20%").

Precios como string con separador de miles ("1.190").

## Lider (Walmart Chile, plataforma Glass)

```
GET https://super.lider.cl/search?query={query}
```

**No requirió Playwright ni GraphQL**: el SSR `__NEXT_DATA__` trae los
productos (nodos `__typename:"Product"` en un árbol anidado; se recorre
buscando el arreglo). Por producto: `usItemId`, `name`, `brand`,
`canonicalUrl` ("/ip/…"), `availabilityStatus` ("IN_STOCK"), `salesUnitType`, y
`priceInfo`:
- `linePrice` (vigente), `wasPrice` (normal/tachado), `unitPrice`
  ("$1.190 x kg"), `savingsAmt`, `memberPriceString` (socio cuando aplica).

Nota: PerimeterX puede bloquear desde datacenter o IPs sospechosas. Si un día
bloquea el HTTP directo, el fallback es un puente de navegador
(`session.fetchAuthedHtml`), ya soportado por el `LiderAdapter`.

## Notas transversales

- Las tres exponen precio socio de forma distinta: Unimarc "Club Unimarc" en el
  tag, Lider `memberPriceString`, Jumbo/Cencosud vía promociones PRIME_USER.
- Fixtures reales: `tests/fixtures/{unimarc-search-detergente,tottus-search-arroz,lider-search-arroz}.json`.
