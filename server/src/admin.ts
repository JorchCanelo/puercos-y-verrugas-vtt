// Listener LOCAL del anfitrión: solo 127.0.0.1. Gestiona Partidas, genera los tokens para entrar como Narrador
// sin contraseña y controla el túnel. Nunca se expone por el túnel (este puerto no se comparte).
import { rm } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import fastifyMultipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import { CreatePartidaBody, PatchPartidaBody } from "@pyv/shared";
import type { HostTokens } from "./auth";
import type { Ctx } from "./ctx";
import { badRequest, conflict, forbidden } from "./errors";
import { idParam, installErrors, installSecurity } from "./http";
import { registerClient } from "./app";
import * as svc from "./services";
import { getPartidaRow } from "./repo";
import type { TunnelManager } from "./tunnel";
import { saveUpload } from "./uploads";

export interface AdminDeps {
  clientDir: string | null;
  hostTokens: HostTokens;
  tunnel: TunnelManager;
  publicPort: number;
  adminPort: number;
  /** Orígenes extra permitidos (solo desarrollo: el servidor de Vite). */
  devOrigins?: string[];
  /** Base de la URL para entrar como Narrador. Por defecto el puerto público local; en desarrollo, Vite. */
  entryBase?: string;
}

const isLoopback = (addr: string | undefined) => !!addr && (addr === "::1" || addr === "127.0.0.1" || addr === "::ffff:127.0.0.1");

export function registerAdminApp(app: FastifyInstance, ctx: Ctx, deps: AdminDeps): void {
  installSecurity(app);
  installErrors(app);
  void app.register(fastifyMultipart, { limits: { files: 1, fields: 5, fileSize: 20 * 1024 * 1024 } });

  const hosts = new Set([`127.0.0.1:${deps.adminPort}`, `localhost:${deps.adminPort}`]);
  const origins = new Set(deps.devOrigins ?? []);
  // Defensa contra "DNS rebinding" y páginas ajenas que intenten llamar a 127.0.0.1:
  // exige conexión local, Host conocido y (si hay) Origin igual al Host o de desarrollo.
  app.addHook("onRequest", async (req) => {
    if (!isLoopback(req.socket.remoteAddress)) throw forbidden();
    const host = (req.headers.host ?? "").toLowerCase();
    if (!hosts.has(host) && !(origins.size > 0 && origins.has(`http://${host}`))) throw forbidden("Host no permitido");
    const origin = req.headers.origin;
    if (origin) {
      let originHost = "";
      try {
        originHost = new URL(origin).host.toLowerCase();
      } catch {
        throw forbidden("Origen no válido");
      }
      if (originHost !== host && !origins.has(origin)) throw forbidden("Origen no permitido");
    }
  });

  app.get("/admin-api/ping", () => ({ ok: true, publicPort: deps.publicPort }));

  app.get("/admin-api/partidas", () => svc.listPartidas(ctx));
  app.get("/admin-api/sistemas", () => svc.listSistemas(ctx));
  app.post("/admin-api/partidas", (req) => svc.createPartida(ctx, CreatePartidaBody.parse(req.body)));
  app.patch("/admin-api/partidas/:id", (req) => svc.patchPartida(ctx, idParam(req), PatchPartidaBody.parse(req.body)));
  app.post("/admin-api/partidas/:id/activar", (req) => svc.setActiva(ctx, idParam(req), true));
  app.post("/admin-api/partidas/:id/desactivar", (req) => svc.setActiva(ctx, idParam(req), false));

  app.delete("/admin-api/partidas/:id", async (req) => {
    const id = idParam(req);
    svc.deletePartida(ctx, id);
    await rm(join(ctx.dataDir, "partidas", id), { recursive: true, force: true });
    return { ok: true };
  });

  app.post("/admin-api/partidas/:id/imagen", async (req) => {
    const id = idParam(req);
    getPartidaRow(ctx.db, id);
    const part = await req.file();
    if (!part) throw badRequest("Falta el archivo");
    const { archivo } = await saveUpload(part.file, { dataDir: ctx.dataDir, partidaId: id, allowed: ["imagen"], maxBytes: { imagen: 10 * 1024 * 1024 } });
    return svc.patchPartida(ctx, id, { imagen: archivo });
  });

  /** Entrar como Narrador anfitrión (sin contraseña): token de un solo uso que se canjea en el listener público. */
  app.post("/admin-api/partidas/:id/entrar", (req) => {
    const id = idParam(req);
    if (!svc.listPartidas(ctx).find((p) => p.id === id)?.activa) throw conflict("Abre la Partida antes de entrar");
    const token = deps.hostTokens.mint(id);
    return { url: `${deps.entryBase ?? `http://127.0.0.1:${deps.publicPort}`}/?hostToken=${encodeURIComponent(token)}` };
  });

  // Direcciones para jugar en red local (Wi-Fi/LAN). Windows pedirá permitir el puerto en el Firewall la primera vez.
  app.get("/admin-api/red", () => {
    const lan: string[] = [];
    for (const list of Object.values(networkInterfaces()))
      for (const ni of list ?? []) if (ni.family === "IPv4" && !ni.internal) lan.push(`http://${ni.address}:${deps.publicPort}`);
    return { publicPort: deps.publicPort, lan, tunnel: deps.tunnel.get() };
  });

  app.get("/admin-api/tunnel", () => deps.tunnel.get());
  app.post("/admin-api/tunnel/start", () => deps.tunnel.start(deps.publicPort));
  app.post("/admin-api/tunnel/stop", () => (deps.tunnel.stop(), deps.tunnel.get()));

  registerClient(app, deps.clientDir);
}
