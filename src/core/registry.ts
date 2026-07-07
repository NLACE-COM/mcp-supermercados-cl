import { CencosudAdapter, JUMBO_CONFIG } from "../adapters/cencosud.js";
import type { StoreAdapter } from "../adapters/base.js";
import type { StoreId } from "./types.js";

/**
 * Mapa cadena -> adaptador. Fase 1: solo Jumbo. Santa Isabel se suma en
 * fase 4 reutilizando CencosudAdapter con SANTA_ISABEL_CONFIG (falta
 * verificar su host de Constructor). Unimarc/Tottus/Lider: fases 5-6.
 */
const adapters = new Map<StoreId, StoreAdapter>();

function register(adapter: StoreAdapter): void {
  adapters.set(adapter.id, adapter);
}

register(new CencosudAdapter(JUMBO_CONFIG));

export function getAdapter(store: StoreId): StoreAdapter {
  const adapter = adapters.get(store);
  if (!adapter) {
    throw new Error(
      `La cadena "${store}" aún no está soportada. Disponibles: ${[...adapters.keys()].join(", ")}.`
    );
  }
  return adapter;
}

export function availableStores(): StoreId[] {
  return [...adapters.keys()];
}
