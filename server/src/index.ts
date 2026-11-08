import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRegistry, secureDie } from "@pyv/shared";
import { MODULE_SYSTEMS } from "./modules.generated";
import { registerAdminApp, registerServerAdmin } from "./admin";
import { applyPendingRestore } from "./backup";
import { readServerConfig, type ServerConfig } from "./config";
import { registerPublicApp } from "./app";
import { HostTokens, LoginLimiter, loadSecret } from "./auth";
import type { Ctx } from "./ctx";
import { openDb } from "./db";
import { loadPacked } from "./packed";
import { createFastify } from "./http";
import { Realtime } from "./realtime";
import { TunnelManager } from "./tunnel";

export interface StartOptions {
  /** Dónde viven la base de datos, el secreto de sesión, los archivos subidos y los módulos empaquetados (modulos/). */
  dataDir?: string;
  /** Puerto público (jugadores / túnel). */
  publicPort?: number;
  /** Puerto local del anfitrión (solo 127.0.0.1). */
  adminPort?: number;
  /** Interfaz del puerto público. 0.0.0.0 permite jugar por LAN; 127.0.0.1 solo con túnel/local. */
  publicHost?: string;
  /** Carpeta del cliente compilado; null = no servir cliente (desarrollo con Vite). */
  clientDir?: string | null;
  logger?: boolean;
  dev?: boolean;
  /** Configuración del modo servidor; por defecto se lee de las variables de entorno (ver config.ts). */
  config?: ServerConfig;
}

export interface RunningServer {
  publicPort: number;
  /** Puerto del panel local; null en modo servidor (el panel está en /admin del puerto público). */
  adminPort: number | null;
  /** VTT_PUBLIC_URL, si se configuró. */
  publicUrl: string | null;
  ctx: Ctx;
  close(): Promise<void>;
}

const here = dirname(fileURLToPath(import.meta.url));

export async function start(opts: StartOptions = {}): Promise<RunningServer> {
  const dataDir = resolve(opts.dataDir ?? process.env.VTT_DATA_DIR ?? "data");
  // PORT es la variable que usan la mayoría de plataformas de hosting.
  const publicPort = opts.publicPort ?? Number(process.env.VTT_PORT ?? process.env.PORT ?? 3000);
  const adminPort = opts.adminPort ?? Number(process.env.VTT_ADMIN_PORT ?? 3001);
  const publicHost = opts.publicHost ?? process.env.VTT_PUBLIC_HOST ?? "0.0.0.0";
  const defaultClient = resolve(process.env.VTT_CLIENT_DIR ?? join(here, "..", "..", "client", "dist"));
  // En desarrollo (`--dev`) no se sirve client/dist: podría ser una compilación vieja y los jugadores verían una versión distinta a la del anfitrión.
  const clientDir = opts.clientDir === undefined ? (!opts.dev && existsSync(defaultClient) ? defaultClient : null) : opts.clientDir;
  const logger = opts.logger ?? false;
  const config = opts.config ?? readServerConfig();
  const serverMode = config.adminPassword !== null;

  // Una copia de datos preparada desde el panel (o un restaurar.pyvbak dejado en la carpeta) se aplica aquí,
  // antes de abrir la base de datos.
  await applyPendingRestore(dataDir);
  const db = openDb(join(dataDir, "vtt.sqlite"));
  // Módulos empaquetados (.pyvmod): se cargan solo al arrancar. Los de modules/ (código fuente) tienen prioridad.
  const packed = await loadPacked(join(dataDir, "modulos"), new Set(MODULE_SYSTEMS.map((s) => s.id)));
  const hostTokens = new HostTokens();
  const limiter = new LoginLimiter();
  const tunnel = new TunnelManager();

  const devOrigins = opts.dev ? ["http://localhost:5173", "http://127.0.0.1:5173"] : [];
  const publicApp = createFastify(logger, config.trustProxy);
  const realtime = new Realtime(publicApp.server, devOrigins);
  const ctx: Ctx = {
    db,
    notify: realtime,
    now: () => Date.now(),
    die: secureDie,
    secret: loadSecret(dataDir),
    dataDir,
    systems: createRegistry([...MODULE_SYSTEMS, ...packed.systems]),
    connected: (partidaId) => realtime.connectedIds(partidaId),
  };
  realtime.bind(ctx);
  registerPublicApp(publicApp, ctx, { clientDir, hostTokens, limiter, packed });
  const modulos = { packed, source: MODULE_SYSTEMS };

  let adminApp: ReturnType<typeof createFastify> | null = null;
  let closing: Promise<void> | null = null;
  const close = () =>
    (closing ??= (async () => {
      tunnel.stop();
      realtime.io.disconnectSockets(true);
      await adminApp?.close();
      await publicApp.close();
      db.close();
    })());

  if (serverMode) {
    // MODO SERVIDOR: un solo puerto; el panel del anfitrión va en /admin con contraseña.
    registerServerAdmin(publicApp, ctx, {
      clientDir,
      hostTokens,
      tunnel,
      publicPort,
      modulos,
      password: config.adminPassword as string,
      publicUrl: config.publicUrl,
      limiter: new LoginLimiter(5, 60_000),
      restoreMaxBytes: config.restoreMaxBytes,
      restart: () => void close().finally(() => process.exit(0)),
    });
  } else {
    adminApp = createFastify(logger);
    registerAdminApp(adminApp, ctx, { clientDir, hostTokens, tunnel, publicPort, adminPort, devOrigins, entryBase: opts.dev ? "http://localhost:5173" : undefined,
      modulos,
      restoreMaxBytes: config.restoreMaxBytes,
    });
  }

  await publicApp.listen({ port: publicPort, host: publicHost });
  await adminApp?.listen({ port: adminPort, host: "127.0.0.1" });

  return {
    publicPort,
    adminPort: adminApp ? adminPort : null,
    publicUrl: config.publicUrl,
    ctx,
    close,
  };
}
