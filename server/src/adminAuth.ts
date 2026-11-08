// Sesión del panel del anfitrión en MODO SERVIDOR (VTT_ADMIN_PASSWORD). En local el panel no usa esto:
// lo protege que solo escucha en 127.0.0.1.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "vtt_admin";
export const ADMIN_TTL_MS = 1000 * 60 * 60 * 12; // 12 h

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** Compara contraseñas en tiempo constante (se comparan sus hashes, que siempre miden lo mismo). */
export function checkAdminPassword(given: string, expected: string): boolean {
  return timingSafeEqual(sha256(given), sha256(expected));
}

/**
 * La clave de firma depende del secreto de la mesa Y de la contraseña: si cambias VTT_ADMIN_PASSWORD,
 * todas las sesiones del panel abiertas con la anterior dejan de valer.
 */
const adminKey = (secret: Buffer, password: string) => createHmac("sha256", secret).update(`pyv-admin|${password}`).digest();

export function signAdmin(secret: Buffer, password: string, now: number): string {
  const body = Buffer.from(JSON.stringify({ adm: 1, e: now + ADMIN_TTL_MS })).toString("base64url");
  const sig = createHmac("sha256", adminKey(secret, password)).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyAdmin(secret: Buffer, password: string, token: string | undefined, now: number): boolean {
  if (!token) return false;
  const [body, sig] = token.split(".");
  if (!body || !sig) return false;
  const expected = createHmac("sha256", adminKey(secret, password)).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { adm?: number; e?: number };
    return p.adm === 1 && typeof p.e === "number" && p.e > now;
  } catch {
    return false;
  }
}
