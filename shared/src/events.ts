import type { FichaDto, MensajeDto, MusicDto, TiradaDto } from "./types";

/** Pistas de qué cambió; el cliente vuelve a pedir su snapshot filtrado (única fuente de verdad). */
export type StateScope =
  | "partida"
  | "usuarios"
  | "pjs"
  | "npcs"
  | "escenas"
  | "fichas"
  | "catalogo"
  | "playlists"
  | "materiales"
  | "tiradas"
  | "chat";

export interface ServerToClientEvents {
  "state:changed": (p: { scopes: StateScope[] }) => void;
  "tirada:nueva": (t: TiradaDto) => void;
  "mensaje:nuevo": (m: MensajeDto) => void;
  "ficha:movida": (f: FichaDto) => void;
  "musica:estado": (m: MusicDto & { serverNow: number }) => void;
  "presencia": (p: { conectados: string[] }) => void;
}

export interface ClientToServerEvents {
  /** Para estimar el desfase de reloj con el servidor (música sincronizada). */
  "tiempo:sync": (ack: (serverNow: number) => void) => void;
}

export const MAX_PLAYERS_CONNECTED = 10;
