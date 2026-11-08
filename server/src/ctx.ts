import type { Actor, Die, FichaDto, MensajeDto, MusicDto, StateScope, SystemRegistry, TiradaDto } from "@pyv/shared";
import type { Db } from "./db";

/** Cómo el servidor avisa a los clientes. La implementación real usa Socket.IO (realtime.ts). */
export interface Notifier {
  /** "Algo cambió": los clientes vuelven a pedir su snapshot filtrado. */
  changed(partidaId: string, scopes: StateScope[]): void;
  /** El notificador decide a quién emitir según `visibilidad` y `autorId`. */
  tirada(partidaId: string, t: TiradaDto): void;
  /** Público → toda la Partida; susurro → solo autor y destinatario. */
  mensaje(partidaId: string, m: MensajeDto): void;
  /** `soloNarradores`: la ficha está oculta a los jugadores. */
  ficha(partidaId: string, f: FichaDto, soloNarradores: boolean): void;
  musica(partidaId: string, m: MusicDto & { serverNow: number }): void;
  /** La Partida se cerró: desconectar a todos. */
  partidaCerrada(partidaId: string): void;
  /** Se borró el usuario o cambió su contraseña: desconectar sus sockets (su sesión ya no vale). */
  usuarioExpulsado(partidaId: string, usuarioId: string): void;
}

export interface Ctx {
  db: Db;
  notify: Notifier;
  now(): number;
  die: Die;
  secret: Buffer;
  dataDir: string;
  /** Sistemas de juego instalados. */
  systems: SystemRegistry;
  /** Ids de usuarios con al menos un socket conectado. */
  connected(partidaId: string): string[];
}

/** Usuario autenticado dentro de una Partida. */
export interface ServerActor extends Actor {
  partidaId: string;
  nombre: string;
}
