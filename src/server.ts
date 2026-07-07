import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAdapterStatus } from "./tools/adapterStatus.js";
import { registerBuildList } from "./tools/buildList.js";
import { registerGetFrequentPurchases } from "./tools/getFrequentPurchases.js";
import { registerGetOffers } from "./tools/getOffers.js";
import { registerGetProduct } from "./tools/getProduct.js";
import { registerSearchProducts } from "./tools/searchProducts.js";
import { registerSuggestSwaps } from "./tools/suggestSwaps.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "mcp-supermercados-cl",
    version: "0.3.0",
  });

  // Núcleo: armar la mejor lista con la sesión del usuario
  registerBuildList(server);
  registerSuggestSwaps(server);
  registerGetFrequentPurchases(server);
  // Lectura de catálogo
  registerSearchProducts(server);
  registerGetProduct(server);
  registerGetOffers(server);
  // Diagnóstico
  registerAdapterStatus(server);

  return server;
}
