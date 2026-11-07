// Permisos de los jugadores sobre un NPC o un material: Ninguno / Observador / Propietario (ver `Acceso` en @pyv/shared).
// Los Narradores no aparecen: siempre tienen todo.
import type { Acceso } from "@pyv/shared";
import { Select, cx } from "../ui";
import { useMe } from "../util";

export const NIVEL_LABEL = { observador: "Observador", propietario: "Propietario" } as const;

export function AccessEditor({
  acceso,
  setAcceso,
  excludeId,
  disabled,
  help,
}: {
  acceso: Acceso[];
  setAcceso: (a: Acceso[]) => void;
  /** Quien ya tiene todo (el creador de un material). */
  excludeId?: string;
  /** Atenuado (p. ej. con «visible para todos» marcado). */
  disabled?: boolean;
  /** Qué significa cada nivel en este recurso. */
  help: string;
}) {
  const { snap } = useMe();
  const players = snap.usuarios.filter((u) => u.id !== excludeId && u.rol === "jugador");
  const levelOf = (id: string) => acceso.find((a) => a.usuarioId === id)?.nivel ?? "";
  const setLevel = (id: string, nivel: string) =>
    setAcceso([...acceso.filter((a) => a.usuarioId !== id), ...(nivel ? [{ usuarioId: id, nivel: nivel as Acceso["nivel"] }] : [])]);
  return (
    <div className={cx("space-y-1", disabled && "opacity-50")}>
      {players.length === 0 && <p className="text-xs text-muted">No hay otros jugadores.</p>}
      {players.map((u) => (
        <div key={u.id} className="flex items-center gap-2">
          {/* El select va en un contenedor de ancho fijo: con `w-auto` sobre su `w-full` tapaba el nombre. */}
          <span className="min-w-0 flex-1 truncate text-sm" title={u.nombre}>
            {u.nombre}
          </span>
          <div className="w-36 shrink-0">
            <Select value={levelOf(u.id)} onChange={(e) => setLevel(u.id, e.target.value)} aria-label={`Permiso de ${u.nombre}`}>
              <option value="">Ninguno</option>
              <option value="observador">Observador</option>
              <option value="propietario">Propietario</option>
            </Select>
          </div>
        </div>
      ))}
      {players.length > 0 && <p className="pt-1 text-xs text-muted">{help}</p>}
    </div>
  );
}

/** "Ana (propietario), Beto (observador)" para mostrar en una lista. */
export function accessSummary(acceso: Acceso[], name: (id: string) => string): string {
  return acceso.map((a) => `${name(a.usuarioId)} (${NIVEL_LABEL[a.nivel].toLowerCase()})`).join(", ");
}
