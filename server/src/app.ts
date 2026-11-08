// Listener PÚBLICO: es el que ven los jugadores (LAN, túnel). Sirve la API del juego, los archivos,
// el cliente web y Socket.IO. NUNCA emite tokens del anfitrión; solo los canjea.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseCookie, serialize as serializeCookie } from "cookie";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import {
  CreateFichaBody,
  CreatePjBody,
  CreateUserBody,
  SetPasswordBody,
  EscenaBody,
  FreeRollBody,
  HostExchangeBody,
  LoginBody,
  MaterialBody,
  MoveRollBody,
  MusicBody,
  NpcBody,
  PatchEscenaBody,
  PatchFichaBody,
  PatchMaterialBody,
  PatchNpcBody,
  PatchPjBody,
  PistaBody,
  PlaylistBody,
  ChatBody,
  isNarrator,
} from "@pyv/shared";
import { z } from "zod";
import { SESSION_COOKIE, SESSION_TTL_MS, type HostTokens, type LoginLimiter } from "./auth";
import type { Ctx } from "./ctx";
import { FILE_NAME_RE, LIMITS_NARRATOR, LIMITS_PLAYER, saveUpload } from "./uploads";
import { HttpError, badRequest, notFound } from "./errors";
import { actorOf, idParam, installErrors, installSecurity, type Reply } from "./http";
import * as svc from "./services";
import { buildSnapshot } from "./snapshot";
import { clientInfo, type LoadedPacked } from "./packed";

export interface PublicDeps {
  clientDir: string | null;
  hostTokens: HostTokens;
  limiter: LoginLimiter;
  /** Módulos empaquetados (.pyvmod) cargados al arrancar. */
  packed?: LoadedPacked;
}

export function registerPublicApp(app: FastifyInstance, ctx: Ctx, deps: PublicDeps): void {
  installSecurity(app);
  installErrors(app);
  void app.register(fastifyMultipart, { limits: { files: 1, fields: 5, fileSize: 100 * 1024 * 1024 } });
  // Solo decora reply.sendFile() para servir archivos de las Partidas (con autenticación propia, ver /archivos).
  void app.register(fastifyStatic, { root: join(ctx.dataDir, "partidas"), serve: false });

  app.decorateRequest("actor", null);
  // Las cookies se leen/escriben a mano: así no depende del orden de carga de plugins.
  app.addHook("onRequest", async (req) => {
    req.actor = svc.authenticate(ctx, parseCookie(req.headers.cookie ?? "")[SESSION_COOKIE]);
  });

  const setSession = (req: { protocol: string }, reply: Reply, token: string) =>
    reply.header(
      "Set-Cookie",
      serializeCookie(SESSION_COOKIE, token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: req.protocol === "https", // true detrás del túnel HTTPS (trustProxy: loopback)
        maxAge: Math.floor(SESSION_TTL_MS / 1000),
      }),
    );

  // --- público / autenticación ---------------------------------------------------
  app.get("/api/public/partidas", () => svc.listPartidasActivas(ctx));

  app.get("/api/public/partidas/:id/imagen", (req, reply) => {
    const row = ctx.db.prepare("SELECT id, imagen, activa FROM partidas WHERE id = ?").get(idParam(req));
    if (!row || Number(row.activa) !== 1 || !row.imagen) throw notFound();
    return reply.header("Cache-Control", "public, max-age=300").sendFile(`${String(row.id)}/archivos/${String(row.imagen)}`);
  });

  app.post("/api/auth/login", async (req, reply) => {
    const body = LoginBody.parse(req.body);
    if (!deps.limiter.attempt(`${req.ip}|${body.partidaId}`)) throw new HttpError(429, "Demasiados intentos. Espera un minuto.");
    const { token, usuario } = await svc.login(ctx, body);
    setSession(req, reply, token);
    return usuario;
  });

  app.post("/api/auth/host-exchange", (req, reply) => {
    const { token } = HostExchangeBody.parse(req.body);
    if (!deps.limiter.attempt(`${req.ip}|host`)) throw new HttpError(429, "Demasiados intentos. Espera un minuto.");
    const { token: session, usuario } = svc.exchangeHostToken(ctx, deps.hostTokens, token);
    setSession(req, reply, session);
    return usuario;
  });

  app.post("/api/auth/logout", (_req, reply) => {
    reply.header("Set-Cookie", serializeCookie(SESSION_COOKIE, "", { path: "/", httpOnly: true, sameSite: "lax", maxAge: 0 }));
    return { ok: true };
  });

  // --- estado ----------------------------------------------------------------------
  app.get("/api/state", (req) => buildSnapshot(ctx, actorOf(req)));

  // --- usuarios --------------------------------------------------------------------
  app.post("/api/usuarios", (req) => svc.createUser(ctx, actorOf(req), CreateUserBody.parse(req.body)));
  app.delete("/api/usuarios/:id", (req) => (svc.deleteUser(ctx, actorOf(req), idParam(req)), { ok: true }));
  app.put("/api/usuarios/:id/password", async (req) => {
    await svc.setUserPassword(ctx, actorOf(req), idParam(req), SetPasswordBody.parse(req.body).password);
    return { ok: true };
  });

  // --- personajes ------------------------------------------------------------------
  app.post("/api/pjs", (req) => svc.createPj(ctx, actorOf(req), CreatePjBody.parse(req.body)));
  app.patch("/api/pjs/:id", (req) => svc.patchPj(ctx, actorOf(req), idParam(req), PatchPjBody.parse(req.body)));
  app.post("/api/pjs/:id/progreso", (req) => svc.progressPj(ctx, actorOf(req), idParam(req), req.body));
  app.delete("/api/pjs/:id", (req) => (svc.deletePj(ctx, actorOf(req), idParam(req)), { ok: true }));

  // --- NPCs ------------------------------------------------------------------------
  app.post("/api/npcs", (req) => svc.createNpc(ctx, actorOf(req), NpcBody.parse(req.body)));
  app.patch("/api/npcs/:id", (req) => svc.patchNpc(ctx, actorOf(req), idParam(req), PatchNpcBody.parse(req.body)));
  app.delete("/api/npcs/:id", (req) => (svc.deleteNpc(ctx, actorOf(req), idParam(req)), { ok: true }));

  // --- escenas y fichas --------------------------------------------------------------
  app.post("/api/escenas", (req) => svc.createEscena(ctx, actorOf(req), EscenaBody.parse(req.body)));
  app.patch("/api/escenas/:id", (req) => svc.patchEscena(ctx, actorOf(req), idParam(req), PatchEscenaBody.parse(req.body)));
  app.delete("/api/escenas/:id", (req) => (svc.deleteEscena(ctx, actorOf(req), idParam(req)), { ok: true }));
  app.put("/api/proyeccion", (req) => {
    const { escenaId } = z.object({ escenaId: z.string().nullable() }).parse(req.body);
    svc.proyectarEscena(ctx, actorOf(req), escenaId);
    return { ok: true };
  });
  app.post("/api/escenas/:id/fichas", (req) => svc.createFicha(ctx, actorOf(req), idParam(req), CreateFichaBody.parse(req.body)));
  app.patch("/api/fichas/:id", (req) => svc.moveFicha(ctx, actorOf(req), idParam(req), PatchFichaBody.parse(req.body)));
  app.delete("/api/fichas/:id", (req) => (svc.deleteFicha(ctx, actorOf(req), idParam(req)), { ok: true }));

  // --- tiradas -----------------------------------------------------------------------
  app.post("/api/tiradas/movimiento", (req) => svc.rollMovement(ctx, actorOf(req), MoveRollBody.parse(req.body)));
  app.post("/api/chat", (req) => svc.sendMessage(ctx, actorOf(req), ChatBody.parse(req.body)));
  /** Solo el Narrador: borra tiradas y chat de la Partida para todos. */
  app.delete("/api/registro", (req) => svc.clearLog(ctx, actorOf(req)));
  app.post("/api/tiradas/libre", (req) => svc.rollFree(ctx, actorOf(req), FreeRollBody.parse(req.body)));

  // --- catálogo de la Partida (del sistema de juego) --------------------------------------
  app.post("/api/catalogo", (req) => svc.addCatalogEntry(ctx, actorOf(req), req.body));

  // --- materiales ----------------------------------------------------------------------
  app.post("/api/materiales", (req) => svc.createMaterial(ctx, actorOf(req), MaterialBody.parse(req.body)));
  app.patch("/api/materiales/:id", (req) => svc.patchMaterial(ctx, actorOf(req), idParam(req), PatchMaterialBody.parse(req.body)));
  app.delete("/api/materiales/:id", (req) => (svc.deleteMaterial(ctx, actorOf(req), idParam(req)), { ok: true }));

  // --- música --------------------------------------------------------------------------
  app.post("/api/playlists", (req) => svc.createPlaylist(ctx, actorOf(req), PlaylistBody.parse(req.body).nombre));
  app.delete("/api/playlists/:id", (req) => (svc.deletePlaylist(ctx, actorOf(req), idParam(req)), { ok: true }));
  app.post("/api/playlists/:id/pistas", (req) => svc.addPista(ctx, actorOf(req), idParam(req), PistaBody.parse(req.body)));
  app.delete("/api/pistas/:id", (req) => (svc.deletePista(ctx, actorOf(req), idParam(req)), { ok: true }));
  app.post("/api/musica", (req) => svc.controlMusic(ctx, actorOf(req), MusicBody.parse(req.body)));

  // --- archivos ------------------------------------------------------------------------
  app.post("/api/archivos", async (req) => {
    const actor = actorOf(req);
    const part = await req.file();
    if (!part) throw badRequest("Falta el archivo");
    const narrator = isNarrator(actor);
    return saveUpload(part.file, {
      dataDir: ctx.dataDir,
      partidaId: actor.partidaId,
      allowed: narrator ? ["imagen", "pdf", "audio"] : ["imagen", "pdf"],
      maxBytes: narrator ? LIMITS_NARRATOR : LIMITS_PLAYER,
    });
  });

  // Solo se sirven archivos de la propia Partida del usuario (el nombre es un UUID impredecible).
  app.get("/archivos/:name", (req, reply) => {
    const actor = actorOf(req);
    const name = (req.params as { name: string }).name;
    if (!FILE_NAME_RE.test(name)) throw notFound();
    return reply.header("Cache-Control", "private, max-age=3600").sendFile(`${actor.partidaId}/archivos/${name}`);
  });

  // --- módulos empaquetados (.pyvmod): interfaz y estilos para el navegador ------------------
  // Solo con sesión: el código del módulo es para quien juega en esta mesa.
  app.get("/api/modulos", (req) => (actorOf(req), clientInfo(deps.packed)));
  app.get("/modulos/estilos.css", (req, reply) => {
    actorOf(req);
    const css = deps.packed?.css;
    if (!css) throw notFound();
    return reply.type("text/css; charset=utf-8").header("Cache-Control", "private, max-age=86400").send(css.text);
  });
  app.get("/modulos/:id/:file", (req, reply) => {
    actorOf(req);
    const { id, file } = req.params as { id: string; file: string };
    const ui = deps.packed?.ui.get(id);
    if (!ui || file !== `${ui.hash}.js`) throw notFound();
    // El nombre lleva el hash del contenido: se puede guardar en caché sin miedo a versiones viejas.
    return reply.type("text/javascript; charset=utf-8").header("Cache-Control", "private, max-age=31536000, immutable").send(ui.js);
  });

  registerClient(app, deps.clientDir);
}

/** Sirve el cliente compilado (client/dist) con fallback a index.html para el enrutado del lado del cliente. */
export function registerClient(app: FastifyInstance, clientDir: string | null): void {
  const hasClient = clientDir !== null && existsSync(join(clientDir, "index.html"));
  if (hasClient) {
    void app.register(async (scope) => {
      await scope.register(fastifyStatic, { root: clientDir as string, decorateReply: false });
    });
  }
  app.setNotFoundHandler((req, reply) => {
    const isApi = req.url.startsWith("/api/") || req.url.startsWith("/admin-api/") || req.url.startsWith("/archivos/") || req.url.startsWith("/modulos/") || req.url.startsWith("/socket.io/");
    if (hasClient && req.method === "GET" && !isApi) return reply.type("text/html; charset=utf-8").send(readIndex(clientDir as string));
    if (!hasClient && req.method === "GET" && !isApi)
      return reply
        .code(503)
        .type("text/html; charset=utf-8")
        .send(
          "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Puercos y Verrugas VTT</title><body style='font-family:sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem'><h1>Cliente no disponible</h1><p>Este puerto no sirve la interfaz en modo desarrollo. Para jugar con otras personas ejecuta <code>npm run play</code> en la carpeta del proyecto.</p>",
        );
    return reply.code(404).send({ error: "No encontrado" });
  });
}

let indexCache: { dir: string; html: string } | null = null;
function readIndex(dir: string): string {
  if (!indexCache || indexCache.dir !== dir) indexCache = { dir, html: readFileSync(join(dir, "index.html"), "utf8") };
  return indexCache.html;
}
