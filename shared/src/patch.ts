import { z } from "zod";

type NoDefaults<T extends z.ZodRawShape> = { [K in keyof T]: T[K] extends z.ZodDefault<infer I> ? I : T[K] };

/**
 * Versión "PATCH" de un objeto: todos los campos opcionales y SIN valores por defecto.
 * (En Zod 4 un `.default()` dentro de `.optional()` se aplica, y un PATCH vacío pisaría datos existentes.)
 */
export function patchOf<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([k, f]) => [k, f instanceof z.ZodDefault ? f.unwrap() : f]),
  ) as NoDefaults<T>;
  return z.object(shape).partial();
}
