import { spawn, type ChildProcess } from "node:child_process";

export interface TunnelState {
  estado: "detenido" | "iniciando" | "activo" | "error";
  url: string | null;
  error: string | null;
}

/**
 * Comparte la Partida por internet con un "Quick Tunnel" de Cloudflare (gratis, sin cuenta, URL aleatoria).
 * Requiere el binario `cloudflared` (Windows: `winget install Cloudflare.cloudflared`) o CLOUDFLARED_PATH.
 */
export class TunnelManager {
  private proc: ChildProcess | null = null;
  private state: TunnelState = { estado: "detenido", url: null, error: null };

  get(): TunnelState {
    return { ...this.state };
  }

  start(localPort: number, binary = process.env.CLOUDFLARED_PATH || "cloudflared", timeoutMs = 30_000): Promise<TunnelState> {
    if (this.proc) return Promise.resolve(this.get());
    this.state = { estado: "iniciando", url: null, error: null };
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(this.get());
        }
      };
      const fail = (error: string) => {
        this.state = { estado: "error", url: null, error };
        this.proc?.kill();
        this.proc = null;
        done();
      };
      const timer = setTimeout(() => fail("cloudflared no devolvió una URL a tiempo"), timeoutMs);

      const proc = spawn(binary, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${localPort}`], { windowsHide: true });
      this.proc = proc;
      const onData = (buf: Buffer) => {
        const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(buf.toString());
        if (m && this.state.estado !== "activo") {
          this.state = { estado: "activo", url: m[0], error: null };
          done();
        }
      };
      proc.stdout?.on("data", onData);
      proc.stderr?.on("data", onData); // cloudflared escribe sus logs en stderr
      proc.on("error", (e: NodeJS.ErrnoException) =>
        fail(e.code === "ENOENT" ? "No se encontró cloudflared. Instálalo con: winget install Cloudflare.cloudflared" : e.message),
      );
      proc.on("exit", (code) => {
        this.proc = null;
        if (this.state.estado === "activo" || this.state.estado === "iniciando")
          this.state = code === 0 || code === null ? { estado: "detenido", url: null, error: null } : { estado: "error", url: null, error: `cloudflared terminó con código ${code}` };
        done();
      });
    });
  }

  stop(): void {
    this.proc?.kill();
    this.proc = null;
    this.state = { estado: "detenido", url: null, error: null };
  }
}
