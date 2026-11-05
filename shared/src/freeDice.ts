// Dados libres: parte genérica del VTT (no depende del sistema de juego).
// Los usa cualquier usuario (Narrador o Jugador) desde el panel de dados o con el comando de chat `/r`.

/** Dados permitidos en las tiradas libres. */
export const DICE_SIDES = [2, 4, 6, 8, 10, 12, 20, 100] as const;
export type DiceSides = (typeof DICE_SIDES)[number];

/** Límites de una tirada libre (se validan también en el servidor). */
export const FREE_DICE_MAX = 20;
export const FREE_MOD_MIN = -20;
export const FREE_MOD_MAX = 20;

export interface FreeDiceExpr {
  cantidad: number;
  caras: DiceSides;
  modificador: number;
}

export const isDiceSides = (n: number): n is DiceSides => (DICE_SIDES as readonly number[]).includes(n);

/** "3d8+2", "d20", "2d6 - 1", "1D100". Devuelve la expresión o un mensaje de error en español. */
export function parseDiceExpr(input: string): FreeDiceExpr | { error: string } {
  const m = /^\s*(\d*)\s*[dD]\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*$/.exec(input);
  if (!m) return { error: "Formato no válido. Ejemplos: 1d20, 3d8+2, 2d6-1" };
  const cantidad = m[1] ? Number(m[1]) : 1;
  const caras = Number(m[2]);
  const modificador = m[4] ? (m[3] === "-" ? -1 : 1) * Number(m[4]) : 0;
  if (cantidad < 1 || cantidad > FREE_DICE_MAX) return { error: `La cantidad de dados va de 1 a ${FREE_DICE_MAX}` };
  if (!isDiceSides(caras)) return { error: `Dado no permitido. Usa: ${DICE_SIDES.map((d) => `d${d}`).join(", ")}` };
  if (modificador < FREE_MOD_MIN || modificador > FREE_MOD_MAX) return { error: `El modificador va de ${FREE_MOD_MIN} a +${FREE_MOD_MAX}` };
  return { cantidad, caras, modificador };
}

/** 3d8+2 · 1d20 · 2d6-1 */
export function formatDiceExpr(e: { cantidad: number; caras: number; modificador: number }): string {
  const mod = e.modificador > 0 ? `+${e.modificador}` : e.modificador < 0 ? `${e.modificador}` : "";
  return `${e.cantidad}d${e.caras}${mod}`;
}

/** Comandos de chat que tiran dados: `/r 3d8+2` (pública) y `/rp 3d8+2` (privada). */
export type ChatRollCommand = { privada: boolean; expr: string };

/** Devuelve el comando si el texto empieza por /r o /rp; null si es un mensaje normal. */
export function parseChatRollCommand(text: string): ChatRollCommand | null {
  const m = /^\/(r|rp|roll)(?:\s+(.*))?$/i.exec(text.trim());
  if (!m) return null;
  return { privada: (m[1] as string).toLowerCase() === "rp", expr: (m[2] ?? "").trim() };
}
