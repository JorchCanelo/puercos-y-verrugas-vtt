// Dados genéricos: el servidor resuelve todas las tiradas con un `Die` inyectable (pruebas deterministas).
/** Función que tira un dado de `sides` caras y devuelve 1..sides. Inyectable para pruebas. */
export type Die = (sides: number) => number;

/** Dado criptográficamente seguro y sin sesgo de módulo (funciona en Node ≥19 y navegadores). */
export const secureDie: Die = (sides) => {
  if (!Number.isInteger(sides) || sides < 2) throw new RangeError("sides must be an integer ≥ 2");
  const limit = Math.floor(0x1_0000_0000 / sides) * sides;
  const buf = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(buf);
  } while ((buf[0] as number) >= limit);
  return ((buf[0] as number) % sides) + 1;
};

export function rollDice(count: number, sides: number, die: Die = secureDie): number[] {
  return Array.from({ length: count }, () => die(sides));
}

export const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
