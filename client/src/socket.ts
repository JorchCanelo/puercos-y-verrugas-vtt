import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@pyv/shared";
import { useStore } from "./store";

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let clockTimer: ReturnType<typeof setInterval> | undefined;

/** Junta ráfagas de cambios en una sola petición de estado. */
function scheduleRefresh() {
  clearTimeout(timer);
  timer = setTimeout(() => void useStore.getState().refresh(), 120);
}

function syncClock() {
  const t0 = Date.now();
  socket?.emit("tiempo:sync", (serverNow) => {
    const t1 = Date.now();
    useStore.getState().setClockOffset(serverNow - (t0 + (t1 - t0) / 2));
  });
}

export function connectSocket(): void {
  if (socket) return;
  const s: Socket<ServerToClientEvents, ClientToServerEvents> = io({ withCredentials: true });
  socket = s;
  const st = useStore.getState;

  // Al conectar Y al RE-conectar se pide el estado completo: no hay que reproducir eventos perdidos.
  s.on("connect", () => {
    st().setOnline(true);
    st().setFatal(null);
    void st().refresh();
    syncClock();
  });
  s.on("disconnect", () => st().setOnline(false));
  s.on("connect_error", (err) => {
    st().setOnline(false);
    if (err.message === "PARTIDA_LLENA") {
      st().setFatal("La Partida está llena (máximo 10 jugadores conectados).");
      s.disconnect();
    } else if (err.message === "UNAUTHORIZED") {
      st().setFatal("Tu sesión terminó o la Partida se cerró.");
      s.disconnect();
    }
  });

  s.on("state:changed", scheduleRefresh);
  s.on("tirada:nueva", (t) => st().pushTirada(t));
  s.on("mensaje:nuevo", (m) => st().pushMensaje(m));
  s.on("ficha:movida", (f) => st().patchFicha(f));
  s.on("presencia", ({ conectados }) => st().setConectados(conectados));
  s.on("musica:estado", (m) => {
    st().setClockOffset(m.serverNow - Date.now());
    st().setMusica(m);
  });

  clockTimer = setInterval(syncClock, 30_000);
}

export function disconnectSocket(): void {
  clearInterval(clockTimer);
  socket?.disconnect();
  socket = null;
}
