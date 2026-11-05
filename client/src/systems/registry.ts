// Interfaces de usuario de los sistemas instalados: el genérico (base) + las de los módulos (modules.generated.ts).
import { useSnap } from "../util";
import { genericoUi } from "./generico";
import { MODULE_UIS } from "./modules.generated";
import type { SystemUi } from "./types";

const UIS = new Map<string, SystemUi>([genericoUi, ...MODULE_UIS].map((u) => [u.id, u]));

export const systemUiFor = (id: string): SystemUi | undefined => UIS.get(id);

/** Interfaz del sistema de la Partida actual, o null si no está instalado (modo solo lectura). */
export function useSystemUi(): SystemUi | null {
  const { partida } = useSnap();
  return (partida.sistemaDisponible && UIS.get(partida.sistema)) || null;
}
