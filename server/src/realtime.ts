import type { Server as HttpServer } from "node:http";
import { parse as parseCookie } from "cookie";
import { Server } from "socket.io";
import { MAX_PLAYERS_CONNECTED, type ClientToServerEvents, type FichaDto, type MensajeDto, type MusicDto, type ServerToClientEvents, type StateScope, type TiradaDto } from "@pyv/shared";
import { SESSION_COOKIE } from "./auth";
import type { Ctx, Notifier } from "./ctx";
import { authenticate } from "./services";

interface SocketData {
  userId: string;
  partidaId: string;
  rol: "narrador" | "jugador";
}

const roomPartida = (p: string) => `p:${p}`;
const roomNarradores = (p: string) => `n:${p}`;
const roomUsuario = (u: string) => `u:${u}`;

/**
 * Socket.IO: una sala por Partida, otra solo para Narradores y otra por usuario.
 * Los eventos NO llevan datos privados (salvo tiradas/fichas, que se emiten ya filtradas por sala);
 * lo demás se reconstruye con el snapshot filtrado del servidor.
 */
export class Realtime implements Notifier {
  readonly io: Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
  private ctx!: Ctx;
  /** partida → usuario → { rol, sockets } */
  private online = new Map<string, Map<string, { rol: "narrador" | "jugador"; n: number }>>();

  constructor(httpServer: HttpServer, extraOrigins: string[] = []) {
    this.io = new Server(httpServer, {
      serveClient: false,
      // Evita secuestro de WebSocket desde otros sitios: el Origin debe coincidir con el Host (o ser el de Vite en desarrollo).
      allowRequest: (req, cb) => {
        const origin = req.headers.origin;
        if (!origin) return cb(null, true);
        try {
          cb(null, new URL(origin).host === req.headers.host || extraOrigins.includes(origin));
        } catch {
          cb(null, false);
        }
      },
    });

    this.io.use((socket, next) => {
      const cookies = parseCookie(socket.request.headers.cookie ?? "");
      const actor = authenticate(this.ctx, cookies[SESSION_COOKIE]);
      if (!actor) return next(new Error("UNAUTHORIZED"));
      if (actor.rol === "jugador") {
        const users = this.online.get(actor.partidaId);
        const already = (users?.get(actor.id)?.n ?? 0) > 0;
        const players = [...(users?.values() ?? [])].filter((u) => u.rol === "jugador" && u.n > 0).length;
        if (!already && players >= MAX_PLAYERS_CONNECTED) return next(new Error("PARTIDA_LLENA"));
      }
      socket.data = { userId: actor.id, partidaId: actor.partidaId, rol: actor.rol };
      next();
    });

    this.io.on("connection", (socket) => {
      const { userId, partidaId, rol } = socket.data;
      void socket.join([roomPartida(partidaId), roomUsuario(userId)]);
      if (rol === "narrador") void socket.join(roomNarradores(partidaId));
      this.bump(partidaId, userId, rol, +1);
      socket.on("tiempo:sync", (ack) => typeof ack === "function" && ack(this.ctx.now()));
      socket.on("disconnect", () => this.bump(partidaId, userId, rol, -1));
    });
  }

  /** Se enlaza después de crear el Ctx (el Ctx necesita al Notifier y el Notifier al Ctx). */
  bind(ctx: Ctx): void {
    this.ctx = ctx;
  }

  private bump(partidaId: string, userId: string, rol: "narrador" | "jugador", delta: 1 | -1): void {
    const users = this.online.get(partidaId) ?? new Map();
    const cur = users.get(userId) ?? { rol, n: 0 };
    cur.n = Math.max(0, cur.n + delta);
    if (cur.n === 0) users.delete(userId);
    else users.set(userId, cur);
    if (users.size === 0) this.online.delete(partidaId);
    else this.online.set(partidaId, users);
    this.io.to(roomPartida(partidaId)).emit("presencia", { conectados: this.connectedIds(partidaId) });
  }

  connectedIds(partidaId: string): string[] {
    return [...(this.online.get(partidaId)?.keys() ?? [])];
  }

  // --- Notifier ---------------------------------------------------------------
  changed(partidaId: string, scopes: StateScope[]): void {
    this.io.to(roomPartida(partidaId)).emit("state:changed", { scopes });
  }

  tirada(partidaId: string, t: TiradaDto): void {
    if (t.visibilidad === "publica") this.io.to(roomPartida(partidaId)).emit("tirada:nueva", t);
    else if (t.visibilidad === "narradores") this.io.to(roomNarradores(partidaId)).emit("tirada:nueva", t);
    else this.io.to(roomNarradores(partidaId)).to(roomUsuario(t.autorId)).emit("tirada:nueva", t);
  }

  mensaje(partidaId: string, m: MensajeDto): void {
    if (m.destinatarioId === null) this.io.to(roomPartida(partidaId)).emit("mensaje:nuevo", m);
    else this.io.to(roomUsuario(m.autorId)).to(roomUsuario(m.destinatarioId)).emit("mensaje:nuevo", m);
  }

  ficha(partidaId: string, f: FichaDto, soloNarradores: boolean): void {
    this.io.to(soloNarradores ? roomNarradores(partidaId) : roomPartida(partidaId)).emit("ficha:movida", f);
  }

  musica(partidaId: string, m: MusicDto & { serverNow: number }): void {
    this.io.to(roomPartida(partidaId)).emit("musica:estado", m);
  }

  partidaCerrada(partidaId: string): void {
    this.io.in(roomPartida(partidaId)).disconnectSockets(true);
  }

  usuarioExpulsado(_partidaId: string, usuarioId: string): void {
    this.io.in(roomUsuario(usuarioId)).disconnectSockets(true);
  }

  close(): Promise<void> {
    return new Promise((resolve) => void this.io.close(() => resolve()));
  }
}
