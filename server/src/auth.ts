import { randomBytes, createHmac, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // Se hace el mismo trabajo aunque el usuario no exista, para no filtrar su existencia por tiempo.
  const parts = (stored ?? "scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAA").split("$");
  const [tag, saltB64, hashB64] = parts;
  if (tag !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64url");
  const got = await scrypt(password, Buffer.from(saltB64, "base64url"), expected.length || 64);
  return stored !== null && expected.length === got.length && timingSafeEqual(expected, got);
}

/** Secreto de firma persistido en el directorio de datos (sobrevive a reinicios → las sesiones también). */
export function loadSecret(dataDir: string): Buffer {
  const file = join(dataDir, "secret.key");
  if (existsSync(file)) return Buffer.from(readFileSync(file, "utf8").trim(), "base64url");
  mkdirSync(dataDir, { recursive: true });
  const secret = randomBytes(32);
  writeFileSync(file, secret.toString("base64url"), { mode: 0o600 });
  return secret;
}

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 días
export const SESSION_COOKIE = "vtt_session";

export interface SessionPayload {
  u: string; // usuario
  p: string; // partida
  e: number; // expira (ms epoch)
}

export function signSession(secret: Buffer, payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(secret: Buffer, token: string | undefined, now: number): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    return typeof p.u === "string" && typeof p.p === "string" && typeof p.e === "number" && p.e > now ? p : null;
  } catch {
    return null;
  }
}

/**
 * Tokens de un solo uso para que el anfitrión entre como su Narrador sin contraseña.
 * Solo se generan desde el listener local (127.0.0.1); el listener público (el que expone el túnel)
 * nunca los emite, solo los canjea. Viven en memoria: caducan a los 60 s y no sobreviven a reinicios.
 */
export class HostTokens {
  private tokens = new Map<string, { partidaId: string; exp: number }>();
  constructor(private now: () => number = Date.now) {}

  mint(partidaId: string): string {
    const token = randomBytes(32).toString("base64url");
    this.tokens.set(token, { partidaId, exp: this.now() + 60_000 });
    return token;
  }

  consume(token: string): string | null {
    const t = this.tokens.get(token);
    this.tokens.delete(token);
    return t && t.exp > this.now() ? t.partidaId : null;
  }
}

/** Limitador simple de intentos de login (en memoria): máx. `max` por ventana y clave. */
export class LoginLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private max = 10,
    private windowMs = 60_000,
    private now: () => number = Date.now,
  ) {}

  /** Devuelve true si se permite el intento (y lo registra). */
  attempt(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((x) => x > t - this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    return true;
  }
}
