import type { Acceso, MaterialSection, MaterialType, Role, Visibilidad } from "./types";

export interface Actor {
  id: string;
  rol: Role;
}

export const isNarrator = (a: Actor) => a.rol === "narrador";

export type Resource =
  | { kind: "pj"; ownerId: string | null; edicionLibre: boolean }
  | { kind: "npc"; acceso: readonly Acceso[] }
  | { kind: "escena" }
  | { kind: "usuario" }
  | { kind: "playlist" }
  | { kind: "musica" }
  /** `duenos`: el dueño del PJ o los propietarios del NPC. */
  | { kind: "ficha"; duenos: readonly string[]; oculta: boolean; proyectada: boolean }
  | { kind: "tirada"; autorId: string; visibilidad: Visibilidad }
  | {
      kind: "material";
      tipo: MaterialType;
      creadorId: string;
      seccion: MaterialSection;
      visibleATodos: boolean;
      acceso: readonly Acceso[];
    };

export type Action = "view" | "create" | "edit" | "delete" | "move" | "changeAccess";

/**
 * Única fuente de verdad de permisos (cliente y servidor).
 * Reglas de grano fino (qué campos de la hoja) están en `checkPjPatch`.
 */
export function can(actor: Actor, action: Action, res: Resource): boolean {
  if (isNarrator(actor)) return true; // Narradores: todo dentro de su Partida.

  switch (res.kind) {
    case "pj":
      if (action === "create") return true;
      if (action === "view") return res.ownerId === actor.id; // solo sus propias hojas
      if (action === "edit") return res.ownerId === actor.id;
      return false; // delete / move / changeAccess: solo Narrador
    case "npc": {
      // Los NPCs los crea y comparte el Narrador; un jugador solo con permiso.
      const nivel = res.acceso.find((a) => a.usuarioId === actor.id)?.nivel;
      if (action === "view") return nivel !== undefined;
      if (action === "edit" || action === "delete") return nivel === "propietario";
      return false;
    }
    case "escena":
    case "usuario":
    case "playlist":
    case "musica":
      return false;
    case "ficha":
      // Su dueño la pone, la mueve y la quita, solo en la escena proyectada y si no está oculta. Ocultar: Narrador.
      if (action === "create" || action === "move" || action === "delete") return res.duenos.includes(actor.id) && res.proyectada && !res.oculta;
      return false;
    case "tirada":
      if (action === "view")
        return res.visibilidad === "publica" || (res.visibilidad === "autor_narradores" && res.autorId === actor.id);
      return false;
    case "material": {
      const entry = res.acceso.find((a) => a.usuarioId === actor.id);
      const mine = res.creadorId === actor.id;
      switch (action) {
        case "create":
          return res.seccion === "grupo"; // jugadores solo suben a "Notas de grupo"
        case "view":
          return mine || res.visibleATodos || entry !== undefined;
        case "edit":
          return res.tipo === "nota" && (mine || entry?.nivel === "propietario");
        case "delete":
        case "changeAccess":
          return mine || entry?.nivel === "propietario";
        default:
          return false;
      }
    }
  }
}

/** ¿Puede este actor ver esta tirada? (el servidor la usa para elegir a quién emitir). */
export const canSeeRoll = (actor: Actor, r: { autorId: string; visibilidad: Visibilidad }) =>
  can(actor, "view", { kind: "tirada", ...r });

/**
 * Valida un PATCH sobre un PJ. Devuelve un mensaje de error o null si es válido.
 * - Narrador: todo.
 * - Jugador dueño con edición libre: toda la hoja e imagen (nunca dueño ni la bandera de edición libre).
 * - Jugador dueño sin edición libre: solo las claves que el sistema declara seguras (`playerSafeKeys`).
 */
export function checkPjPatch(
  actor: Actor,
  pj: { ownerId: string | null; edicionLibre: boolean },
  patch: { sheetKeys: string[]; imagen?: boolean; duenoId?: boolean; edicionLibre?: boolean },
  playerSafeKeys: readonly string[],
): string | null {
  if (isNarrator(actor)) return null;
  if (pj.ownerId !== actor.id) return "No es tu personaje";
  if (patch.duenoId || patch.edicionLibre) return "No puedes cambiar la pertenencia ni los permisos de edición";
  if (pj.edicionLibre) return null;
  if (patch.imagen) return "Tu Narrador no te permite cambiar la imagen";
  const forbidden = patch.sheetKeys.filter((k) => !playerSafeKeys.includes(k));
  return forbidden.length ? `Sin edición libre no puedes modificar: ${forbidden.join(", ")}` : null;
}

/**
 * Visibilidad del chat. Los mensajes públicos los ve toda la Partida. Un susurro solo lo ven su autor y su
 * destinatario: los Narradores NO leen los susurros entre otras personas.
 */
export const canSeeMessage = (actor: Actor, m: { autorId: string; destinatarioId: string | null }) =>
  m.destinatarioId === null || m.autorId === actor.id || m.destinatarioId === actor.id;
