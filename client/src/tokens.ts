// Poner y quitar fichas desde la lista de PJs y NPCs: arrastrando al tablero (PC), con 📍 (poner; en el móvil
// arrastrar entre paneles no funciona bien) y ➡️ (quitar). El Narrador maneja todas en la escena que está viendo;
// un jugador, las de sus PJs y de los NPCs de los que es propietario, en la escena proyectada (el servidor lo comprueba igual).
import type { DragEvent } from "react";
import type { EscenaDto, FichaDto, Snapshot, UsuarioDto } from "@pyv/shared";
import { post } from "./api";
import { run, useStore } from "./store";
import { useMe } from "./util";

export interface TokenRef {
  tipo: "pj" | "npc";
  id: string;
}

/** Tipo de dato del arrastre (los navegadores solo dejan leer los tipos durante dragover, no el contenido). */
export const TOKEN_MIME = "application/x-pyv-ficha";

/** Escena que muestra el tablero: la que el Narrador está viendo, o la proyectada para los jugadores. */
export function useBoardScene(): EscenaDto | null {
  const { snap, narrator } = useMe();
  const viewSceneId = useStore((s) => s.viewSceneId);
  const id = narrator ? (viewSceneId ?? snap.escenaProyectadaId ?? snap.escenas.find((e) => e.abierta)?.id ?? null) : snap.escenaProyectadaId;
  return snap.escenas.find((e) => e.id === id) ?? null;
}

/** ¿Es suya esta ficha? Dueño del PJ o propietario del NPC (los Narradores no cuentan aquí). */
export function isTokenOwner(snap: Snapshot, me: UsuarioDto, ref: TokenRef): boolean {
  if (ref.tipo === "pj") return snap.pjs.some((p) => p.id === ref.id && p.duenoId === me.id);
  return snap.npcs.some((n) => n.id === ref.id && n.acceso.some((a) => a.usuarioId === me.id && a.nivel === "propietario"));
}

/** Ficha de `ref` en la escena, si la tiene. */
export const tokenIn = (snap: Snapshot, escena: EscenaDto | null, ref: TokenRef): FichaDto | undefined =>
  escena ? snap.fichas.find((f) => f.escenaId === escena.id && f.ref.tipo === ref.tipo && f.ref.id === ref.id) : undefined;

/** ¿Puede manejar (poner o quitar) la ficha de `ref` en `escena`? */
export function canHandle(snap: Snapshot, me: UsuarioDto, escena: EscenaDto | null, ref: TokenRef): boolean {
  if (!escena) return false;
  if (me.rol === "narrador") return true;
  return escena.id === snap.escenaProyectadaId && isTokenOwner(snap, me, ref);
}

/** ¿Puede poner la ficha de `ref` en `escena`? (no si ya está en ella). */
export const canPlace = (snap: Snapshot, me: UsuarioDto, escena: EscenaDto | null, ref: TokenRef): boolean =>
  canHandle(snap, me, escena, ref) && !tokenIn(snap, escena, ref);

/** Primera casilla libre de una cuadrícula (recorre por filas). */
export function firstFreeCell(e: EscenaDto, fichas: FichaDto[]): { x: number; y: number } {
  const taken = new Set(fichas.filter((f) => f.escenaId === e.id).map((f) => `${f.x},${f.y}`));
  for (let y = 0; y < e.filas; y++) for (let x = 0; x < e.columnas; x++) if (!taken.has(`${x},${y}`)) return { x, y };
  return { x: 0, y: 0 };
}

/** Pone la ficha. Sin posición: centro de la imagen o primera casilla libre. Los NPC que pone el Narrador entran ocultos. */
export function placeToken(snap: Snapshot, escena: EscenaDto, ref: TokenRef, pos?: { x: number; y: number }) {
  const at = pos ?? (escena.tipo === "cuadricula" ? firstFreeCell(escena, snap.fichas) : { x: 0.5, y: 0.5 });
  const oculta = ref.tipo === "npc" && snap.yo.rol === "narrador";
  return run(() => post(`/api/escenas/${escena.id}/fichas`, { ref, ...at, oculta }));
}

/** Props para que un elemento de la lista se pueda arrastrar al tablero. */
export function tokenDragProps(ref: TokenRef, enabled: boolean) {
  if (!enabled) return {};
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(TOKEN_MIME, JSON.stringify(ref));
      e.dataTransfer.effectAllowed = "copy";
    },
  };
}

export function readTokenDrop(e: DragEvent): TokenRef | null {
  try {
    const ref = JSON.parse(e.dataTransfer.getData(TOKEN_MIME)) as TokenRef;
    return (ref.tipo === "pj" || ref.tipo === "npc") && typeof ref.id === "string" ? ref : null;
  } catch {
    return null;
  }
}
