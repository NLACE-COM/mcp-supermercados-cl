import {
  CencosudAdapter,
  JUMBO_CONFIG,
  SANTA_ISABEL_CONFIG,
} from "../adapters/cencosud.js";
import { LiderAdapter } from "../adapters/lider.js";
import { TottusAdapter } from "../adapters/tottus.js";
import { UnimarcAdapter } from "../adapters/unimarc.js";
import type { StoreAdapter } from "../adapters/base.js";
import type { StoreId } from "./types.js";

/**
 * Mapa cadena -> adaptador. Las cinco cadenas del plan:
 * - Jumbo: ciclo completo (búsqueda, sesión, lista, carro).
 * - Santa Isabel: búsqueda (mismo adaptador Cencosud).
 * - Unimarc (VTEX/BFF), Tottus (Falabella SSR), Lider (Walmart Glass SSR):
 *   búsqueda. Requieren IP residencial (la máquina del usuario); desde
 *   datacenter algunas cadenas bloquean.
 */
const adapters = new Map<StoreId, StoreAdapter>();

function register(adapter: StoreAdapter): void {
  adapters.set(adapter.id, adapter);
}

register(new CencosudAdapter(JUMBO_CONFIG));
register(new CencosudAdapter(SANTA_ISABEL_CONFIG));
register(new UnimarcAdapter());
register(new TottusAdapter());
register(new LiderAdapter());

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
