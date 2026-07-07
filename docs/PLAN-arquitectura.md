# MCP Supermercados Chile — Plan de proyecto

Documento base para arrancar el desarrollo en Claude Code. Reconocimiento hecho el 6 de julio de 2026 sobre los cinco supermercados con navegador real y captura de tráfico de red.

## 1. Idea

Un servidor MCP que deja que Claude o ChatGPT armen la mejor y más conveniente lista dentro del supermercado donde el usuario ya compra. La gente tiende a comprar en una sola cadena, donde es cliente, tiene suscripción y beneficios asociados a su RUT. Ese es el foco: profundidad en una cadena, no amplitud entre varias.

Caso de uso central: el usuario está logueado en su supermercado, con sus precios club y beneficios por RUT activos. Claude arma la lista optimizando por lo que esa persona realmente compra (productos frecuentes, listas guardadas), aplica las ofertas vigentes que le sirven, respeta los precios socio, y sugiere reemplazos más convenientes dentro del mismo catálogo.

Valor real: la conveniencia dentro de una cadena con la sesión y los beneficios del usuario. La comparación entre cadenas queda como capacidad secundaria, útil pero no el corazón del producto.

Consecuencia de diseño: la sesión con login deja de ser una fase tardía y pasa a ser central. Sin login no hay precio club ni beneficios por RUT ni historial de compra, que es justo lo que hace conveniente la lista.

## 2. Hallazgo clave: son cuatro plataformas, no cinco

| Cadena       | Plataforma              | Backend de búsqueda                  | Dificultad                       |
| ------------ | ----------------------- | ------------------------------------ | -------------------------------- |
| Jumbo        | Cencosud e-commerce     | Constructor.io + API propia Cencosud | Baja                             |
| Santa Isabel | Cencosud e-commerce     | Constructor.io + API propia Cencosud | Baja (mismo adaptador que Jumbo) |
| Unimarc      | VTEX IO                 | VTEX Intelligent Search              | Media                            |
| Tottus       | Falabella (Next.js SSR) | API de catálogo Falabella            | Media                            |
| Lider        | Walmart Glass           | GraphQL orchestra                    | Alta (antibots PerimeterX)       |

Con un solo adaptador Cencosud cubres dos cadenas. Como el foco es profundidad en una cadena, se lleva una hasta el final (búsqueda, sesión, precio club, historial, carro) antes de sumar la siguiente. Se parte por Jumbo, que es el caso propio del usuario, y el adaptador Cencosud queda listo para Santa Isabel casi gratis.

## 3. Arquitectura

Un único servidor MCP con adaptadores por cadena, no cinco servidores.

```
mcp-supermercados-cl/
├── src/
│   ├── index.ts                 # entrada MCP, registro de tools
│   ├── server.ts                # setup del McpServer (SDK oficial)
│   ├── core/
│   │   ├── types.ts             # esquema normalizado (Product, Price, Offer, Cart)
│   │   ├── registry.ts          # mapa store -> adapter
│   │   └── normalize.ts         # helpers de normalización de precios y unidades
│   ├── adapters/
│   │   ├── base.ts              # interfaz StoreAdapter
│   │   ├── cencosud.ts          # Jumbo + Santa Isabel
│   │   ├── unimarc.ts           # VTEX
│   │   ├── tottus.ts            # Falabella
│   │   └── lider.ts             # Walmart Glass (fase tardía)
│   ├── tools/
│   │   ├── searchProducts.ts
│   │   ├── getProduct.ts
│   │   ├── comparePrices.ts
│   │   ├── getOffers.ts
│   │   └── cart/               # tools de carro con sesión
│   └── http/
│       ├── client.ts            # fetch con reintentos, rate limit, user-agent
│       └── session.ts           # manejo de cookies por usuario (fase 4)
├── tests/
├── package.json
├── tsconfig.json
└── README.md
```

Stack: TypeScript, `@modelcontextprotocol/sdk`, `zod` para validar inputs de tools, `undici` o fetch nativo para HTTP. Distribución por `npx`. Todo el tráfico sale de la máquina del usuario, a ritmo humano.

### Interfaz de adaptador

La sesión es un parámetro de primera clase, no un añadido tardío. Casi todo lo que hace conveniente la lista (precio club, beneficios por RUT, historial) vive detrás del login.

```ts
interface StoreAdapter {
  id: StoreId; // "jumbo" | "santaisabel" | "unimarc" | "tottus" | "lider"

  // lectura pública (sin sesión):
  searchProducts(query: string, opts: SearchOpts): Promise<Product[]>;
  getProduct(id: string, session?: Session): Promise<Product | null>;
  getOffers(opts: OfferOpts, session?: Session): Promise<Product[]>;

  // con sesión del usuario, núcleo del producto:
  getFrequentPurchases(session: Session): Promise<Product[]>;
  getSavedLists(session: Session): Promise<ShoppingList[]>;
  getMemberPrice(id: string, session: Session): Promise<Price>; // precio club / RUT
  addToCart(items: CartItem[], session: Session): Promise<Cart>;
  getCart(session: Session): Promise<Cart>;
}
```

Nota: `searchProducts` y `getProduct` aceptan sesión opcional porque el precio que ve un socio logueado difiere del precio público. Si hay sesión, se devuelve el precio que le corresponde a ese usuario.

### Esquema normalizado (borrador)

```ts
type Product = {
  store: StoreId;
  id: string;
  sku?: string;
  name: string;
  brand?: string;
  price: number; // precio actual en CLP
  listPrice?: number; // precio lista si hay descuento
  pricePerUnit?: number; // precio por kg/lt para comparar
  unit?: string; // "kg" | "lt" | "un"
  offer?: {
    type: string; // "descuento" | "2x1" | "club" | etc
    description?: string;
    clubOnly?: boolean; // precio socio (Jumbo Prime, Club Unimarc, etc)
  };
  inStock: boolean;
  imageUrl?: string;
  url?: string;
};
```

Nota: cada cadena distingue precio normal y precio con tarjeta o club. Hay que capturar ambos, porque el "mejor precio" depende de si el usuario tiene la tarjeta.

## 4. Endpoints verificados por cadena

Todos los endpoints de abajo se capturaron del tráfico real. Los headers exactos, cookies y payloads GraphQL hay que capturarlos con más detalle en Claude Code (DevTools o mitmproxy), pero la ruta y el patrón están confirmados.

### Cencosud (Jumbo + Santa Isabel)

Búsqueda por Constructor.io (confirmado, devuelve JSON con nombre, marca, precio, stock, promociones, unit_multiplier):

```
GET https://pwcdauseo-zone.cnstrc.com/search/{query}
  ?key=key_JopvNXKS61kwGkBe
  &i={clientId}
  &s=1
  &num_results_per_page=N
```

Notas Cencosud:

- El `key` de Constructor.io es el mismo para Jumbo (capturado). Santa Isabel usa el mismo backend Cencosud; verificar si comparte key o tiene el suyo.
- API propia Cencosud confirmada para ratings: `https://sm-web-api.ecomm.cencosud.com/catalog/api/v1/reviews/ratings?ids=...`. La misma base `sm-web-api.ecomm.cencosud.com/catalog/api/...` probablemente sirve detalle de producto y precios por tienda. Mapear en Claude Code.
- El precio depende de la tienda o comuna seleccionada. Hay que fijar sucursal o región en las requests.
- La respuesta JSON de Constructor trae `promotionData`, `promotionName`, `unit_multiplier`, `stockLevel`, `price`. Base sólida para el esquema.

### Unimarc (VTEX IO)

Confirmado VTEX por `unimarc.vtexassets.com`. Patrón estándar VTEX Intelligent Search:

```
GET https://www.unimarc.cl/api/io/_v/api/intelligent-search/product_search
  ?query={query}&count=N&page=P
```

Fallback VTEX clásico (verificar cuál responde):

```
GET https://www.unimarc.cl/api/catalog_system/pub/products/search/{query}?_from=0&_to=N
```

Nota: los fetch directos sin navegador volvieron vacíos, probablemente falta header `Accept: application/json` o cookie de segmento (`vtex_segment`) que fija la región. Capturar el request completo desde el navegador logueado.

### Tottus (Falabella, Next.js SSR)

La página de búsqueda renderiza los productos en el servidor. HTML de `https://www.tottus.cl/tottus-cl/buscar?Ntt={query}` ya trae nombre, marca, formato, precio unitario, precio por kg y descuento. Dos rutas posibles:

1. Parsear el `__NEXT_DATA__` embebido en el HTML SSR (rápido de arrancar, frágil ante cambios de estructura).
2. Encontrar el API de catálogo Falabella que alimenta el front (más estable). Falabella, Sodimac y Tottus comparten API de catálogo. Capturar el XHR real navegando con filtros y paginación en Claude Code.

Paginación confirmada: `?Ntt={query}&page=N&store=to_com`.

### Lider (Walmart Glass) — fase tardía

Confirmado GraphQL:

```
POST https://super.lider.cl/orchestra/graphql
GET  https://super.lider.cl/orchestra/api/ccm/v3/bootstrap?configNames=...
```

Notas Lider:

- Es la plataforma Glass de Walmart, la misma de walmart.com. Hay documentación comunitaria del esquema GraphQL.
- Protección antibots más agresiva del grupo (PerimeterX). Requests directos serán bloqueados. Aquí probablemente hay que usar Playwright reusando la sesión del navegador del usuario, no fetch plano.
- Requiere fijar modo de entrega y dirección antes de ver precios (retiro pickup o despacho, con comuna).
- Dejar para el final: mayor esfuerzo, menor retorno inicial.

## 5. Tools MCP

Ordenadas por el foco real: armar la mejor lista dentro de una cadena, con la sesión del usuario.

Núcleo (con sesión, es el corazón del producto):

| Tool                     | Input                                                     | Descripción                                                                                                                                                                     |
| ------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build_list`             | `store`, `items[]` (texto libre, ej "leche, arroz, café") | Convierte una lista en lenguaje natural en productos concretos del catálogo, priorizando lo que el usuario ya compra, aplicando precio club y ofertas vigentes. La tool central |
| `get_frequent_purchases` | `store`                                                   | Productos frecuentes del usuario, base para reordenar rápido                                                                                                                    |
| `get_saved_lists`        | `store`                                                   | Listas guardadas del usuario en la cadena                                                                                                                                       |
| `suggest_swaps`          | `store`, `items[]`                                        | Reemplazos más convenientes dentro del mismo catálogo: misma categoría, mejor precio por unidad o mejor oferta para ese usuario                                                 |
| `add_to_cart`            | `store`, `items[]`                                        | Deja la lista lista en el carro para pagar                                                                                                                                      |
| `get_cart`               | `store`                                                   | Estado del carro                                                                                                                                                                |

Lectura de catálogo (soporte, con o sin sesión):

| Tool              | Input                     | Descripción                                                           |
| ----------------- | ------------------------- | --------------------------------------------------------------------- |
| `search_products` | `store`, `query`, `limit` | Busca en una cadena, con precio del usuario si hay sesión             |
| `get_product`     | `store`, `id`             | Detalle: precio normal, precio club, precio por unidad, stock, oferta |
| `get_offers`      | `store`, `category?`      | Ofertas vigentes, filtrables por lo que el usuario compra             |

Comparación entre cadenas (secundaria):

| Tool             | Input                 | Descripción                                                                                    |
| ---------------- | --------------------- | ---------------------------------------------------------------------------------------------- |
| `compare_stores` | `items[]`, `stores[]` | Estima el total de la misma lista en varias cadenas. Útil de vez en cuando, no el flujo diario |

### Lógica de `build_list`

Es la tool que justifica el proyecto. Dado un texto tipo "compra de la semana: leche, arroz, café, detergente", debe:

1. Resolver cada ítem a un producto concreto, prefiriendo lo que el usuario ya compró antes (match contra `get_frequent_purchases`).
2. Aplicar el precio que le corresponde al usuario (club, RUT, suscripción).
3. Cruzar con ofertas vigentes y marcar dónde conviene aprovechar (2x1, descuento socio).
4. Para ítems sin historial, elegir por mejor precio por unidad dentro de la marca o categoría razonable, no el más caro.
5. Devolver la lista con total estimado, ahorro por ofertas, y alternativas por ítem.

## 6. Sesión y login (núcleo, no fase tardía)

Como el foco es la conveniencia con beneficios por RUT, la sesión es parte del núcleo desde la fase 1. Regla de diseño: el servidor MCP nunca ve ni pide credenciales. Dos opciones, en orden de preferencia:

1. Modo local con Playwright que reusa el perfil de Chrome del usuario. La persona ya está logueada en su navegador; el MCP opera esa sesión. Cero credenciales tocan el servidor.
2. Cookies de sesión que el usuario exporta e inyecta como variable de entorno local. Menos cómodo, pero sin navegador.

Esto también resuelve el mayor riesgo legal: no hay un servicio central que scrapee cuentas ajenas. Cada usuario opera su propia cuenta desde su propia IP.

## 7. Riesgos y mitigaciones

| Riesgo                                       | Mitigación                                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Términos de uso prohíben acceso automatizado | Revisar T&C de cada cadena antes de publicar. MCP 100% local, ritmo humano, sin reventa de datos. Publicar como herramienta personal, no como servicio |
| Endpoints cambian sin aviso                  | Adaptadores aislados, tests de contrato por cadena, versión de esquema. Un cambio rompe un adaptador, no todo                                          |
| Bloqueo antibots (sobre todo Lider)          | Rate limiting, user-agent realista, backoff. Para Lider usar sesión de navegador real vía Playwright                                                   |
| Precios dependen de región o tienda          | Parámetro de comuna o sucursal en cada tool. Default configurable por el usuario                                                                       |
| Precio club vs precio normal                 | Capturar ambos en el esquema, exponer los dos al modelo                                                                                                |

## 8. Roadmap por fases

El foco en profundidad reordena todo: se lleva Jumbo hasta el final antes de sumar otra cadena.

Fase 1 — Jumbo lectura pública. Adaptador Cencosud, `search_products`, `get_product`, `get_offers`. Sirve para validar el catálogo, el esquema y el precio por unidad. Entregable: MCP instalable por `npx` que busca en Jumbo.

Fase 2 — Jumbo con sesión. Login vía navegador del usuario, precio club, `get_frequent_purchases`, `get_saved_lists`, `get_member_price`. Aquí aparece el valor real. Entregable: Claude ve tus productos frecuentes y tus precios socio.

Fase 3 — `build_list` y `suggest_swaps` en Jumbo. La tool central que arma la lista óptima. Más `add_to_cart` y `get_cart` para dejar la compra lista. Entregable: caso de uso completo en una cadena, el producto ya es útil de verdad.

Fase 4 — Santa Isabel. Reusa el adaptador Cencosud, casi gratis. Segunda cadena con el mismo nivel de profundidad.

Fase 5 — Unimarc y Tottus. Adaptadores VTEX y Falabella, mismo set de tools con sesión.

Fase 6 — Lider. Playwright + GraphQL, por antibots. La cadena más costosa, al final.

Fase 7 — `compare_stores` y publicación open source. La comparación entre cadenas se habilita cuando ya hay profundidad en varias. README, ejemplos, registro MCP, licencia.

## 9. Primeros pasos en Claude Code

1. Scaffold del repo con la estructura de la sección 3.
2. Definir `core/types.ts` con el esquema normalizado, incluyendo precio normal y precio club.
3. Implementar `http/client.ts` con reintentos y rate limit.
4. Capturar con DevTools el request completo de Constructor.io de Jumbo (headers, key, params de región) y el de detalle de producto de `sm-web-api.ecomm.cencosud.com`.
5. Implementar `adapters/cencosud.ts` y la tool `search_products` (fase 1).
6. Capturar, ya logueado en Jumbo, los requests de productos frecuentes, listas guardadas y precio socio. Esto habilita la fase 2, que es donde está el valor.
7. Probar con Claude Desktop o el inspector MCP.
8. Escribir test de contrato del adaptador Cencosud.

## 10. Antecedentes

El repo público de referencia (maogaz/scrap-chilean-supermarkets) está desactualizado y solo sirve como pista de endpoints históricos. Todo se construye desde cero. Lider en ese repo estaba a medias, Jumbo también, y el resto sin implementar.

robots.txt de las cinco cadenas: todas bloquean rutas de cuenta y checkout a crawlers genéricos y permiten Googlebot. Ninguna expone una API pública oficial. Confirma que el acceso es por endpoints internos, con las implicancias de T&C de la sección 7.
