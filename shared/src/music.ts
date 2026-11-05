import type { MusicState } from "./types";

export const IDLE_MUSIC: MusicState = { pistaId: null, reproduciendo: false, posicionMs: 0, actualizadoEn: 0 };

export type MusicAction =
  | { accion: "play"; pistaId?: string; posicionMs?: number }
  | { accion: "pause" }
  | { accion: "seek"; posicionMs: number }
  | { accion: "stop" };

/** Posición actual estimada. `now` debe estar en el reloj del servidor. */
export function musicPositionMs(s: MusicState, now: number): number {
  return s.reproduciendo ? s.posicionMs + Math.max(0, now - s.actualizadoEn) : s.posicionMs;
}

/** Transición pura del estado de música (el servidor la aplica; los clientes solo leen). */
export function reduceMusic(s: MusicState, a: MusicAction, now: number): MusicState {
  switch (a.accion) {
    case "play": {
      const sameTrack = a.pistaId === undefined || a.pistaId === s.pistaId;
      const pistaId = a.pistaId ?? s.pistaId;
      if (pistaId === null) return s;
      const posicionMs = a.posicionMs ?? (sameTrack ? musicPositionMs(s, now) : 0);
      return { pistaId, reproduciendo: true, posicionMs, actualizadoEn: now };
    }
    case "pause":
      return { ...s, reproduciendo: false, posicionMs: musicPositionMs(s, now), actualizadoEn: now };
    case "seek":
      return { ...s, posicionMs: Math.max(0, a.posicionMs), actualizadoEn: now };
    case "stop":
      return { pistaId: null, reproduciendo: false, posicionMs: 0, actualizadoEn: now };
  }
}
