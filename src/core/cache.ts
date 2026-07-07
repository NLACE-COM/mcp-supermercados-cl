/**
 * Cache en memoria con TTL (default 15 min, regla del plan) para no
 * regolpear los sitios con la misma consulta. Vive lo que el proceso
 * del servidor MCP.
 */
export class TtlCache<T> {
  private entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number = 15 * 60 * 1000,
    private readonly maxEntries: number = 500
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    // Evicción simple: al llegar al tope se borra lo más antiguo insertado.
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  async getOrFetch(key: string, fetcher: () => Promise<T>): Promise<T> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const value = await fetcher();
    this.set(key, value);
    return value;
  }

  clear(): void {
    this.entries.clear();
  }
}
