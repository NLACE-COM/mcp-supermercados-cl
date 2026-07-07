import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StoreAdapter } from "../adapters/base.js";
import { availableStores, getAdapter } from "../core/registry.js";

export interface AdapterHealth {
  store: string;
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

/** Búsqueda mínima real para verificar que el adaptador responde. */
export async function checkAdapter(adapter: StoreAdapter): Promise<AdapterHealth> {
  const startedAt = Date.now();
  try {
    const products = await adapter.searchProducts("leche", { limit: 1 });
    return {
      store: adapter.id,
      ok: products.length > 0,
      latencyMs: Date.now() - startedAt,
      ...(products.length === 0 ? { error: "Respuesta vacía" } : {}),
    };
  } catch (err) {
    return {
      store: adapter.id,
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function registerAdapterStatus(server: McpServer): void {
  server.registerTool(
    "adapter_status",
    {
      title: "Estado de las cadenas",
      description:
        "Diagnóstico en vivo: qué cadenas soportadas están respondiendo ahora y con qué latencia. " +
        "Úsalo si otra tool falla, para distinguir un endpoint caído de un error de uso.",
      inputSchema: {},
    },
    async () => {
      const results: AdapterHealth[] = [];
      for (const store of availableStores()) {
        results.push(await checkAdapter(getAdapter(store)));
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { stores: results, checkedAt: new Date().toISOString() },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
