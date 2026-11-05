import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRegistry, secureDie } from "@pyv/shared";
import { MODULE_SYSTEMS } from "./modules.generated";
import { registerAdminApp } from "./admin";
import { registerPublicApp } from "./app";
import { HostTokens, LoginLimiter, loadSecret } from "./auth";
import type { Ctx } from "./ctx";
import { openDb } from "./db";
import { createFastify } from "./http";
import { Realtime } from "./realtime";
import { TunnelManager } from "./tunnel";

export interface StartOptions {
  /** Dónde viven la base de datos, el secreto de sesión y los archivos subidos. */
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
}

export interface RunningServer {
  publicPort: number;
  adminPort: number;
  ctx: Ctx;
  close(): Promise<void>;
}

const here = dirname(fileURLToPath(import.meta.url));

export async function start(opts: StartOptions = {}): Promise<RunningServer> {
  const dataDir = resolve(opts.dataDir ?? process.env.VTT_DATA_DIR ?? "data");
  const publicPort = opts.publicPort ?? Number(process.env.VTT_PORT ?? 3000);
  const adminPort = opts.adminPort ?? Number(process.env.VTT_ADMIN_PORT ?? 3001);
  const publicHost = opts.publicHost ?? process.env.VTT_PUBLIC_HOST ?? "0.0.0.0";
  const defaultClient = resolve(process.env.VTT_CLIENT_DIR ?? join(here, "..", "..", "client", "dist"));
  // En desarrollo (`--dev`) no se sirve client/dist: podría ser una compilación vieja y los jugadores verían una versión distinta a la del anfitrión.
  const clientDir = opts.clientDir === undefined ? (!opts.dev && existsSync(defaultClient) ? defaultClient : null) : opts.clientDir;
  const logger = opts.logger ?? false;

  const db = openDb(join(dataDir, "vtt.sqlite"));
  const hostTokens = new HostTokens();
  const limiter = new LoginLimiter();
  const tunnel = new TunnelManager();

  const devOrigins = opts.dev ? ["http://localhost:5173", "http://127.0.0.1:5173"] : [];
  const publicApp = createFastify(logger);
  const realtime = new Realtime(publicApp.server, devOrigins);
  const ctx: Ctx = {
    db,
    notify: realtime,
    now: () => Date.now(),
    die: secureDie,
    secret: loadSecret(dataDir),
    dataDir,
    systems: createRegistry(MODULE_SYSTEMS),
    connected: (partidaId) => realtime.connectedIds(partidaId),
  };
  realtime.bind(ctx);
  registerPublicApp(publicApp, ctx, { clientDir, hostTokens, limiter });

  const adminApp = createFastify(logger);
  registerAdminApp(adminApp, ctx, { clientDir, hostTokens, tunnel, publicPort, adminPort, devOrigins, entryBase: opts.dev ? "http://localhost:5173" : undefined });

  await publicApp.listen({ port: publicPort, host: publicHost });
  await adminApp.listen({ port: adminPort, host: "127.0.0.1" });

  return {
    publicPort,
    adminPort,
    ctx,
    async close() {
      tunnel.stop();
      realtime.io.disconnectSockets(true);
      await adminApp.close();
      await publicApp.close();
      db.close();
    },
  };
}
