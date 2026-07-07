import { describe, expect, it } from "vitest";
import { toActionableError } from "../../src/core/errors.js";
import { HttpStatusError } from "../../src/http/client.js";

describe("toActionableError", () => {
  it("401/403 => sesión expirada con acción de re-login", () => {
    const e = toActionableError(new HttpStatusError("https://x/cart", 401));
    expect(e.kind).toBe("session_expired");
    expect(e.action).toMatch(/logueado|sesión|browserSnippet/i);
  });

  it("404 => not_found con acción de revisar id/sucursal", () => {
    const e = toActionableError(new HttpStatusError("https://x/p/1", 404));
    expect(e.kind).toBe("not_found");
  });

  it("429 => rate_limited", () => {
    const e = toActionableError(new HttpStatusError("https://x", 429));
    expect(e.kind).toBe("rate_limited");
  });

  it("timeout => timeout con reintento", () => {
    const e = toActionableError(new Error("The operation was aborted due to timeout"));
    expect(e.kind).toBe("timeout");
    expect(e.action).toMatch(/reintenta/i);
  });

  it("cadena residencial agrega la pista de IP", () => {
    const e = toActionableError(new Error("fetch failed"), "lider");
    expect(e.kind).toBe("network");
    expect(e.action).toMatch(/residencial/i);
  });

  it("error desconocido cae a unknown con mensaje original", () => {
    const e = toActionableError(new Error("algo raro"));
    expect(e.kind).toBe("unknown");
    expect(e.message).toContain("algo raro");
  });
});
