// Configuración del modo servidor por variables de entorno. Sin ellas, el VTT funciona exactamente como en local
// (dos listeners: público 0.0.0.0:3000 y panel del anfitrión en 127.0.0.1:3001).

export type TrustProxy = boolean | number | string | string[];

export interface ServerConfig {
  /** Contraseña del panel del anfitrión. Si existe, se activa el MODO SERVIDOR: un solo puerto y panel en /admin. */
  adminPassword: string | null;
  /** URL pública (https://mi-dominio): para el enlace «Entrar como Narrador» y para mostrarla en el panel. */
  publicUrl: string | null;
  /** En qué proxies confiar para X-Forwarded-For/Proto (IP real del jugador y https). */
  trustProxy: TrustProxy;
  /** Tamaño máximo de una copia de datos subida para restaurar (bytes). */
  restoreMaxBytes: number;
}

export const MIN_ADMIN_PASSWORD = 8;

/**
 * Lee la configuración del entorno. Lanza un Error con un mensaje claro si algo está mal escrito:
 * es mejor que el servidor no arranque a que arranque con el panel desprotegido.
 */
export function readServerConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const rawPassword = env.VTT_ADMIN_PASSWORD;
  const adminPassword = rawPassword && rawPassword.length > 0 ? rawPassword : null;
  if (adminPassword !== null && adminPassword.length < MIN_ADMIN_PASSWORD)
    throw new Error(`VTT_ADMIN_PASSWORD debe tener al menos ${MIN_ADMIN_PASSWORD} caracteres`);

  let publicUrl: string | null = null;
  const rawUrl = env.VTT_PUBLIC_URL?.trim();
  if (rawUrl) {
    let u: URL;
    try {
      u = new URL(rawUrl);
    } catch {
      throw new Error(`VTT_PUBLIC_URL no es una URL válida: ${rawUrl}`);
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("VTT_PUBLIC_URL debe empezar por https:// o http://");
    publicUrl = u.origin;
  }

  const restoreMb = Number(env.VTT_RESTORE_MAX_MB ?? 4096);
  if (!Number.isFinite(restoreMb) || restoreMb <= 0) throw new Error("VTT_RESTORE_MAX_MB debe ser un número positivo");

  return { adminPassword, publicUrl, trustProxy: parseTrustProxy(env.VTT_TRUST_PROXY), restoreMaxBytes: Math.floor(restoreMb * 1024 * 1024) };
}

/**
 * VTT_TRUST_PROXY:
 *  · sin definir → "loopback" (como siempre: cloudflared en la misma máquina o en el mismo contenedor de red)
 *  · "true"/"1"  → confiar en cualquier proxy (hosts tipo Railway/Render, donde el proxy es de la plataforma)
 *  · "false"/"0" → no confiar en ninguno
 *  · un número   → número de saltos de proxy
 *  · lista de IPs/rangos separados por comas (p. ej. "loopback,172.16.0.0/12")
 */
export function parseTrustProxy(raw: string | undefined): TrustProxy {
  const v = raw?.trim();
  if (!v) return "loopback";
  const lower = v.toLowerCase();
  if (lower === "true" || lower === "1" || lower === "yes") return true;
  if (lower === "false" || lower === "0" || lower === "no") return false;
  if (/^\d+$/.test(v)) return Number(v);
  const list = v.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length === 1 ? (list[0] as string) : list;
}
