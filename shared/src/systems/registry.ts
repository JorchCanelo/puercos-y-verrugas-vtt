import type { GameSystem } from "../system";
import { genericoSystem, GENERIC_SYSTEM_ID } from "./generico";

/** Sistema por defecto de una Partida nueva (siempre está: lo trae el VTT base). */
export const DEFAULT_SYSTEM_ID = GENERIC_SYSTEM_ID;

export interface SystemRegistry {
  get(id: string): GameSystem<any> | undefined;
  list(): GameSystem<any>[];
}

/**
 * Registro de sistemas. El genérico siempre está, aunque no venga en la lista.
 * Los sistemas de los módulos instalados los aporta el servidor (server/src/modules.generated.ts).
 */
export function createRegistry(systems: readonly GameSystem<any>[]): SystemRegistry {
  const map = new Map<string, GameSystem<any>>([[genericoSystem.id, genericoSystem]]);
  for (const s of systems) {
    if (map.has(s.id) && map.get(s.id) !== s) throw new Error(`Sistema duplicado: ${s.id}`);
    map.set(s.id, s);
  }
  return { get: (id) => map.get(id), list: () => [...map.values()] };
}
