import { isNarrator as isNarratorRole, type PjDto, type Snapshot, type UsuarioDto } from "@pyv/shared";
import { useStore } from "./store";

/** `crypto.randomUUID` solo existe en contextos seguros (https / localhost); por LAN en http no. */
export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** Snapshot garantizado (solo se usa dentro de la mesa, donde ya hay sesión). */
export function useSnap(): Snapshot {
  const snap = useStore((s) => s.snap);
  if (!snap) throw new Error("Sin sesión");
  return snap;
}

export function useMe() {
  const snap = useSnap();
  const me = snap.yo;
  return { snap, me, narrator: isNarratorRole({ id: me.id, rol: me.rol }) };
}

export const userName = (snap: Snapshot, id: string | null | undefined): string => snap.usuarios.find((u) => u.id === id)?.nombre ?? "—";

export const pjName = (pj: PjDto) => pj.nombre;

export const isOnline = (snap: Snapshot, u: UsuarioDto) => snap.conectados.includes(u.id);

/** Copia al portapapeles con respaldo para contextos http (LAN). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function remember(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return null; // almacenamiento bloqueado: la app funciona igual
  }
}
