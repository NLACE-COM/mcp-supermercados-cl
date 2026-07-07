#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout es del protocolo MCP; los logs van a stderr.
  console.error(
    "mcp-supermercados-cl listo (stdio). Cadenas: Jumbo, Santa Isabel, Unimarc, Tottus y Lider."
  );
}

main().catch((err) => {
  console.error("Error fatal al iniciar el servidor MCP:", err);
  process.exit(1);
});
