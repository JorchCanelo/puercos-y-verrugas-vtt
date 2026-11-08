// Panel del anfitrión. Gestiona Partidas, genera los tokens para entrar como Narrador sin contraseña, módulos,
// copias de datos y (en local) el túnel. Hay dos formas de protegerlo:
//  · LOCAL (por defecto): listener propio en 127.0.0.1, solo accesible desde la computadora del anfitrión.
//  · SERVIDOR (VTT_ADMIN_PASSWORD): mismas rutas en el listener público, en /admin, tras una contraseña.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { parse as parseCookie, serialize as serializeCookie } from "cookie";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { CreatePartidaBody, PatchPartidaBody, type GameSystem } from "@pyv/shared";
import { ADMIN_COOKIE, ADMIN_TTL_MS, checkAdminPassword, signAdmin, verifyAdmin } from "./adminAuth";
import type { HostTokens, LoginLimiter } from "./auth";
import { BackupError, backupFileName, cancelRestore, createBackup, dataUsage, restorePending, stageRestore } from "./backup";
import type { Ctx } from "./ctx";
import { HttpError, badRequest, conflict, forbidden, notFound, unauthorized, unprocessable } from "./errors";
import { idParam, installErrors, installSecurity } from "./http";
import { registerClient } from "./app";
import * as svc from "./services";
import { getPartidaRow } from "./repo";
import type { TunnelManager } from "./tunnel";
import { saveUpload } from "./uploads";
import { PACKED_FILE_RE, incompatibility, moduleStatus, parsePacked, scanPacked, type LoadedPacked } from "./packed";

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
  /** Módulos: los empaquetados (.pyvmod, con su carpeta) y los de código fuente (modules/). */
  modulos?: { packed: LoadedPacked; source: readonly GameSystem<any>[] };
  /** Tamaño máximo de una copia subida para restaurar. */
  restoreMaxBytes?: number;
}

export interface ServerAdminDeps extends Omit<AdminDeps, "adminPort" | "devOrigins"> {
  /** VTT_ADMIN_PASSWORD. */
  password: string;
  /** VTT_PUBLIC_URL (si no, se usa la dirección con la que se abrió el panel). */
  publicUrl: string | null;
  limiter: LoginLimiter;
  /** Detiene el proceso para que el gestor (Docker, systemd…) lo vuelva a arrancar. */
  restart: () => void;
}

/** Diferencias entre el panel local y el del servidor que necesitan las rutas comunes. */
interface Mode {
  servidor: { publicUrl: string | null; restart: () => void } | null;
}

const MODULE_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_RESTORE_MAX = 4 * 1024 * 1024 * 1024;

const isLoopback = (addr: string | undefined) => !!addr && (addr === "::1" || addr === "127.0.0.1" || addr === "::ffff:127.0.0.1");

/** Listener LOCAL del anfitrión (127.0.0.1). Nunca se expone por el túnel. */
export function registerAdminApp(app: FastifyInstance, ctx: Ctx, deps: AdminDeps): void {
  installSecurity(app);
  installErrors(app);
  void app.register(fastifyMultipart, { limits: { files: 1, fields: 5, fileSize: MODULE_MAX_BYTES } }); // imagen 10 MB, módulo 20 MB
  // Solo decora reply.sendFile() para la imagen de las Partidas (ver GET /admin-api/partidas/:id/imagen).
  void app.register(fastifyStatic, { root: join(ctx.dataDir, "partidas"), serve: false });

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

  app.get("/admin-api/sesion", () => ({ servidor: false, autenticado: true }));
  registerAdminRoutes(app, ctx, deps, { servidor: null });
  registerClient(app, deps.clientDir);
}

const ADMIN_OPEN = new Set(["/admin-api/sesion", "/admin-api/login", "/admin-api/logout"]);

/**
 * MODO SERVIDOR: el panel vive en el listener público (que ya tiene seguridad, errores, multipart y archivos
 * registrados) bajo /admin-api, protegido con contraseña y una cookie propia (vtt_admin).
 * Llamar ANTES de registerClient (que se registra en registerPublicApp, así que va después de ella: los hooks
 * de onRequest aplican igual a todas las rutas del listener).
 */
export function registerServerAdmin(app: FastifyInstance, ctx: Ctx, deps: ServerAdminDeps): void {
  const authed = (req: FastifyRequest) => verifyAdmin(ctx.secret, deps.password, parseCookie(req.headers.cookie ?? "")[ADMIN_COOKIE], ctx.now());

  app.addHook("onRequest", async (req) => {
    const path = req.url.split("?")[0] ?? "";
    if (!path.startsWith("/admin-api/")) return;
    // La cookie es SameSite=Strict; además, si el navegador manda Origin, debe ser esta misma dirección.
    const origin = req.headers.origin;
    if (origin) {
      let originHost = "";
      try {
        originHost = new URL(origin).host.toLowerCase();
      } catch {
        throw forbidden("Origen no válido");
      }
      const publicHost = deps.publicUrl ? new URL(deps.publicUrl).host.toLowerCase() : null;
      if (originHost !== (req.headers.host ?? "").toLowerCase() && originHost !== publicHost) throw forbidden("Origen no permitido");
    }
    if (!ADMIN_OPEN.has(path) && !authed(req)) throw unauthorized("Inicia sesión en el panel del anfitrión");
  });

  const cookie = (req: FastifyRequest, value: string, maxAgeMs: number) =>
    serializeCookie(ADMIN_COOKIE, value, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: req.protocol === "https",
      maxAge: Math.floor(maxAgeMs / 1000),
    });

  app.get("/admin-api/sesion", (req) => ({ servidor: true, autenticado: authed(req) }));

  app.post("/admin-api/login", (req, reply) => {
    const { password } = z.object({ password: z.string().max(500) }).parse(req.body);
    if (!deps.limiter.attempt(`admin|${req.ip}`)) throw new HttpError(429, "Demasiados intentos. Espera un minuto.");
    if (!checkAdminPassword(password, deps.password)) throw unauthorized("Contraseña incorrecta");
    reply.header("Set-Cookie", cookie(req, signAdmin(ctx.secret, deps.password, ctx.now()), ADMIN_TTL_MS));
    return { ok: true };
  });

  app.post("/admin-api/logout", (req, reply) => {
    reply.header("Set-Cookie", cookie(req, "", 0));
    return { ok: true };
  });

  registerAdminRoutes(app, ctx, { ...deps, adminPort: 0 }, { servidor: { publicUrl: deps.publicUrl, restart: deps.restart } });
}

/** Rutas comunes del panel (la protección la pone quien las registra). */
function registerAdminRoutes(app: FastifyInstance, ctx: Ctx, deps: AdminDeps, mode: Mode): void {
  const servidor = mode.servidor;

  app.get("/admin-api/ping", () => ({ ok: true, publicPort: deps.publicPort, servidor: servidor !== null }));

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

  // Imagen de la Partida para el panel: abierta o cerrada (la ruta pública /api/public/... solo sirve las abiertas).
  app.get("/admin-api/partidas/:id/imagen", (req, reply) => {
    const row = ctx.db.prepare("SELECT id, imagen FROM partidas WHERE id = ?").get(idParam(req));
    if (!row || !row.imagen) throw notFound();
    return reply.header("Cache-Control", "no-cache").sendFile(`${String(row.id)}/archivos/${String(row.imagen)}`);
  });

  /** Entrar como Narrador anfitrión (sin contraseña): token de un solo uso que se canjea en el listener público. */
  app.post("/admin-api/partidas/:id/entrar", (req) => {
    const id = idParam(req);
    if (!svc.listPartidas(ctx).find((p) => p.id === id)?.activa) throw conflict("Abre la Partida antes de entrar");
    const token = deps.hostTokens.mint(id);
    const base = deps.entryBase ?? (servidor ? (servidor.publicUrl ?? `${req.protocol}://${req.headers.host ?? ""}`) : `http://127.0.0.1:${deps.publicPort}`);
    return { url: `${base}/?hostToken=${encodeURIComponent(token)}` };
  });

  // --- módulos empaquetados (.pyvmod) ----------------------------------------------------
  // Se cargan al arrancar: instalar, actualizar o quitar uno se aplica al reiniciar (el panel lo avisa).
  const modulos = () => {
    if (!deps.modulos) throw notFound("Gestión de módulos no disponible");
    return deps.modulos;
  };
  app.get("/admin-api/modulos", () => moduleStatus(modulos().packed, modulos().source));

  app.post("/admin-api/modulos", async (req) => {
    const { packed, source } = modulos();
    const part = await req.file();
    if (!part) throw badRequest("Falta el archivo");
    const buf = await part.toBuffer();
    if (buf.length > MODULE_MAX_BYTES) throw unprocessable("El módulo es demasiado grande (máximo 20 MB)");
    let m;
    try {
      m = parsePacked(buf);
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    const incompatible = incompatibility(m);
    if (incompatible) throw unprocessable(incompatible);
    if (source.some((s) => s.id === m.id)) throw conflict(`"${m.nombre}" ya está instalado como código fuente en modules/`);
    await mkdir(packed.dir, { recursive: true });
    // Un solo archivo por módulo: instalar otra versión sustituye a la anterior.
    for (const f of scanPacked(packed.dir)) if (f.modulo?.id === m.id) await rm(join(packed.dir, f.archivo), { force: true });
    await writeFile(join(packed.dir, `${m.id}.pyvmod`), buf);
    return moduleStatus(packed, source);
  });

  app.delete("/admin-api/modulos/:archivo", async (req) => {
    const { packed, source } = modulos();
    const archivo = (req.params as { archivo: string }).archivo;
    if (!PACKED_FILE_RE.test(archivo) || !scanPacked(packed.dir).some((f) => f.archivo === archivo)) throw notFound("No existe ese archivo de módulo");
    await rm(join(packed.dir, archivo), { force: true });
    return moduleStatus(packed, source);
  });

  // --- red: en local, enlaces de LAN y túnel; en servidor, la dirección pública ----------------
  app.get("/admin-api/red", (req) => {
    if (servidor)
      return {
        publicPort: deps.publicPort,
        lan: [],
        tunnel: { estado: "detenido", url: null, error: null },
        servidor: { url: servidor.publicUrl ?? `${req.protocol}://${req.headers.host ?? ""}` },
      };
    const lan: string[] = [];
    for (const list of Object.values(networkInterfaces()))
      for (const ni of list ?? []) if (ni.family === "IPv4" && !ni.internal) lan.push(`http://${ni.address}:${deps.publicPort}`);
    return { publicPort: deps.publicPort, lan, tunnel: deps.tunnel.get(), servidor: null };
  });

  // El túnel rápido es para jugar desde casa sin servidor; en modo servidor la dirección pública ya cumple esa función.
  if (!servidor) {
    app.get("/admin-api/tunnel", () => deps.tunnel.get());
    app.post("/admin-api/tunnel/start", () => deps.tunnel.start(deps.publicPort));
    app.post("/admin-api/tunnel/stop", () => (deps.tunnel.stop(), deps.tunnel.get()));
  }

  // --- datos: espacio, copia y restauración ------------------------------------------------
  const datos = async () => ({
    ...(await dataUsage(ctx.dataDir)),
    carpeta: ctx.dataDir,
    restauracionPendiente: restorePending(ctx.dataDir),
    servidor: servidor !== null,
    puedeReiniciar: servidor !== null,
  });
  app.get("/admin-api/datos", datos);

  app.get("/admin-api/copia", async (_req, reply) => {
    const stream = await createBackup(ctx.db, ctx.dataDir, ctx.now());
    return reply
      .header("Content-Type", "application/gzip")
      .header("Content-Disposition", `attachment; filename="${backupFileName(ctx.now())}"`)
      .header("Cache-Control", "no-store")
      .send(stream);
  });

  // La copia se envía tal cual (application/octet-stream) y se lee en streaming: puede pesar cientos de MB.
  void app.register(async (scope) => {
    scope.addContentTypeParser("application/octet-stream", (_req, payload, done) => done(null, payload));
    scope.post("/admin-api/copia/restaurar", async (req) => {
      const body = req.body as Readable | undefined;
      if (!body || typeof body.pipe !== "function") throw badRequest("Envía el archivo de la copia (.pyvbak)");
      try {
        const r = await stageRestore(body, ctx.dataDir, deps.restoreMaxBytes ?? DEFAULT_RESTORE_MAX);
        return { ...r, ...(await datos()) };
      } catch (e) {
        if (e instanceof BackupError) throw unprocessable(e.message);
        throw e;
      }
    });
  });

  app.delete("/admin-api/copia/restaurar", async () => {
    await cancelRestore(ctx.dataDir);
    return datos();
  });

  if (servidor)
    app.post("/admin-api/reiniciar", () => {
      // Se responde antes de salir; el gestor (Docker con restart: unless-stopped, systemd…) lo vuelve a arrancar.
      setTimeout(servidor.restart, 300);
      return { ok: true };
    });
}
