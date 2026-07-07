import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGetOffers } from "./tools/getOffers.js";
import { registerGetProduct } from "./tools/getProduct.js";
import { registerSearchProducts } from "./tools/searchProducts.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "mcp-supermercados-cl",
    version: "0.1.0",
  });

  registerSearchProducts(server);
  registerGetProduct(server);
  registerGetOffers(server);

  return server;
}
