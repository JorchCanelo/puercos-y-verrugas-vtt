import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { RuleError } from "@pyv/shared";
import type { TrustProxy } from "./config";
import type { ServerActor } from "./ctx";
import { HttpError, unauthorized } from "./errors";

declare module "fastify" {
  interface FastifyRequest {
    actor: ServerActor | null;
  }
}

export function createFastify(logger: boolean, trustProxy: TrustProxy = "loopback"): FastifyInstance {
  return Fastify({
    logger: logger ? { level: "info" } : false,
    // Por defecto solo se confía en cabeceras X-Forwarded-* cuando vienen del túnel local (cloudflared conecta desde
    // 127.0.0.1). En un servidor detrás de otro proxy se ajusta con VTT_TRUST_PROXY (ver config.ts).
    // Fastify acepta un número de saltos en tiempo de ejecución, pero sus tipos no lo declaran.
    trustProxy: trustProxy as boolean | string | string[],
    bodyLimit: 1024 * 1024,
    forceCloseConnections: true,
  });
}

/** Cabeceras de seguridad comunes a los dos listeners. */
export function installSecurity(app: FastifyInstance): void {
  app.addHook("onSend", async (_req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "same-origin");
    reply.header("X-Frame-Options", "SAMEORIGIN");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; frame-src 'self'; object-src 'self'; frame-ancestors 'self'",
    );
  });
}

/** Errores de dominio → respuestas JSON `{ error }` con el código HTTP correcto. */
export function installErrors(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, req, reply) => {
    if (error instanceof HttpError) return reply.code(error.status).send({ error: error.message });
    if (error instanceof RuleError) return reply.code(422).send({ error: error.message });
    if (error instanceof ZodError)
      return reply.code(400).send({ error: "Datos inválidos", detalles: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    const e = error as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message ?? "Solicitud inválida" });
    req.log.error(error);
    return reply.code(500).send({ error: "Error interno del servidor" });
  });
}

export const actorOf = (req: FastifyRequest): ServerActor => {
  if (!req.actor) throw unauthorized();
  return req.actor;
};

export const idParam = (req: FastifyRequest): string => (req.params as { id: string }).id;

export type Reply = FastifyReply;
