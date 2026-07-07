import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAdapterStatus } from "./tools/adapterStatus.js";
import { registerBuildList } from "./tools/buildList.js";
import { registerCartTools } from "./tools/cart.js";
import { registerCompareStores } from "./tools/compareStores.js";
import { registerFindOpportunities } from "./tools/findOpportunities.js";
import { registerGetFrequentPurchases } from "./tools/getFrequentPurchases.js";
import { registerGetSavedLists } from "./tools/getSavedLists.js";
import { registerGetOffers } from "./tools/getOffers.js";
import { registerGetProduct } from "./tools/getProduct.js";
import { registerSearchProducts } from "./tools/searchProducts.js";
import { registerSuggestSwaps } from "./tools/suggestSwaps.js";
import { registerDiscoverBranch } from "./tools/discoverBranch.js";
import { registerPrompts } from "./prompts.js";

// La versión sale de package.json para que no vuelva a quedar desfasada.
const { version } = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

/**
 * Guía de alto nivel para el modelo (aparece como `instructions` del server).
 * Le dice cómo conducir la conversación: qué cadena, cuándo pedir sesión, y
 * cómo reaccionar a errores. El objetivo es que el usuario no tenga que saber
 * de sucursales, tokens ni tools: el modelo lo guía.
 */
const SERVER_INSTRUCTIONS = `
Servidor para armar la mejor lista de compra en supermercados chilenos (Jumbo,
Santa Isabel, Unimarc, Tottus, Lider). Foco: profundidad en la cadena donde el
usuario ya compra (precios socio, frecuentes, carro), con la comparación entre
cadenas como capacidad secundaria.

Cómo guiar al usuario:
- Si no dice cadena, asume "jumbo" (la de mayor cobertura) y ofrécele cambiarla.
- No le pidas códigos técnicos. Para la sucursal, usa el prompt/flujo de
  "descubrir sucursal" (una tool devuelve un browserSnippet que la lee del
  navegador). Solo pide branchId si el usuario lo sabe.
- Precios socio (Prime/Club), frecuentes, listas y carro requieren SESIÓN. Las
  tools respectivas devuelven un browserSnippet de UNA llamada para ejecutar en
  una pestaña logueada del sitio; el usuario pega el JSON de vuelta. NUNCA pidas
  usuario/clave ni intentes extraer el estado de React o el DOM a mano.
- Precios SIEMPRE en CLP enteros. Usa "price" (vigente), "listPrice" (normal) y
  "memberPrice" (socio) sin mezclarlos. Prefiere comparar por precio por unidad.
- Ante un error, lee su campo "action": dice el siguiente paso concreto para el
  usuario (ej. re-loguearse, reintentar, usar IP residencial). Comunícaselo.

Sugerencias de partida (prompts): armar_lista, comparar_carro, ofertas_frecuentes,
conectar_sesion.
`.trim();

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "mcp-supermercados-cl",
      version,
    },
    { instructions: SERVER_INSTRUCTIONS }
  );

  // Núcleo: armar la mejor lista con la sesión del usuario
  registerBuildList(server);
  registerSuggestSwaps(server);
  registerGetFrequentPurchases(server);
  registerGetSavedLists(server);
  // Carro
  registerCartTools(server);
  // Lectura de catálogo
  registerSearchProducts(server);
  registerGetProduct(server);
  registerGetOffers(server);
  // Oportunidades (mayor descuento + stock) para recomendar
  registerFindOpportunities(server);
  // Comparación entre cadenas (secundaria)
  registerCompareStores(server);
  // Diagnóstico
  registerAdapterStatus(server);
  // Descubrimiento de sucursal (quita fricción: no pedir branchId a mano)
  registerDiscoverBranch(server);
  // Prompts guiados (descubribilidad para el usuario)
  registerPrompts(server);

  return server;
}
