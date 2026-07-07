import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";

/** El `extra` que recibe el handler de cada tool del SDK. */
export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export type NotifyProgressFn = (
  progress: number,
  total: number,
  message: string
) => Promise<void>;

/**
 * Notificador de progreso MCP para tools largas (build_list,
 * compare_stores). Si el cliente pidió progreso (mandó `progressToken`),
 * envía `notifications/progress`; si no, es un no-op. Nunca lanza: el
 * progreso es cosmético y no debe romper la tool.
 */
export function progressNotifier(extra: ToolExtra): NotifyProgressFn {
  const progressToken = extra._meta?.progressToken;
  return async (progress, total, message) => {
    if (progressToken === undefined) return;
    try {
      await extra.sendNotification({
        method: "notifications/progress",
        params: { progressToken, progress, total, message },
      });
    } catch {
      // Cliente sin soporte o desconectado: seguimos sin progreso.
    }
  };
}
