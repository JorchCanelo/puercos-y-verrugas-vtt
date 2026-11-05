// Interfaz que implementa un sistema de juego (reglas + hoja de personaje).
// El VTT base no conoce ninguna regla concreta: el servidor y el cliente le piden todo al sistema de la Partida.
// Esta parte NO usa React: la comparten servidor y cliente. La interfaz de usuario de cada sistema vive en el cliente
// (ver client/src/systems).
import type { z } from "zod";
import type { Die } from "./dice";

/** Error de reglas (jugada no permitida). El servidor lo convierte en un 422 con este mensaje. */
export class RuleError extends Error {}

/** Tono del resultado de una tirada: decide el color con el que se muestra. */
export type RollTone = "exito" | "parcial" | "fallo" | "neutro";
export const ROLL_TONES: readonly RollTone[] = ["exito", "parcial", "fallo", "neutro"];

/** Resultado de un movimiento, tal cual se guarda en el registro de tiradas. */
export interface MoveResult {
  movimientoId: string;
  movimientoNombre: string;
  /** Hechizo, objeto u otra elección (texto libre para el registro). */
  detalle: string | null;
  /** Id de la estadística usada (si el sistema las tiene) y su nombre para mostrar. */
  stat: string | null;
  statEtiqueta: string | null;
  caras: number;
  dados: number[];
  modificador: number;
  total: number;
  /** Id del resultado (p. ej. "exito") y su texto para mostrar. */
  resultado: string | null;
  resultadoEtiqueta: string | null;
  resultadoTono: RollTone | null;
}

export interface RollContext {
  die: Die;
  /** Los Narradores pueden tirar sin restricciones (p. ej. sin elegir hechizo). */
  narrador: boolean;
}

/** Entrada del catálogo de la Partida (p. ej. hechizos para autocompletar). */
export interface CatalogDef<E> {
  entrySchema: z.ZodType<E>;
  /** Clave única dentro de la Partida (dos entradas con la misma clave son la misma). */
  key(entry: E): string;
  /** Entradas que aparecen en una hoja: alimentan el catálogo al guardarla. */
  fromSheet(sheet: unknown): E[];
}

export interface GameSystem<S = unknown> {
  /** Identificador estable (se guarda en `partidas.sistema`). Sin espacios ni mayúsculas. */
  id: string;
  /** Nombre para mostrar. */
  nombre: string;
  version: string;

  sheet: {
    /** Esquema de la hoja completa. Los campos nuevos deben tener `.default()` para no romper hojas antiguas. */
    schema: z.ZodType<S>;
    /** Esquema de un PATCH (todos los campos opcionales y SIN defaults: usa `patchOf`). */
    patchSchema: z.ZodType<Partial<S>>;
    /** Hoja nueva con solo el nombre (si el sistema permite crear así; el genérico lo usa). */
    empty?(nombre: string): S;
    /** Nombre del personaje (fichas, chat, tiradas). */
    displayName(sheet: S): string;
    /** Claves de primer nivel que el jugador dueño puede editar SIN edición libre. */
    playerSafeKeys: readonly string[];
    /** Ajustes que hace el servidor al guardar (p. ej. ids únicos). */
    normalize?(sheet: S, newId: () => string): S;
    /** Reglas de creación que se exigen a los jugadores (el Narrador crea libremente). Lista de errores. */
    validateCreation?(sheet: S): string[];
  };

  /** ¿Puede actuar (tirar movimientos)? Por defecto, sí. Los Narradores siempre pueden. */
  canAct?(sheet: S): boolean;

  moves?: {
    /** Elecciones del movimiento (estadística, hechizo…). El servidor las valida con esto antes de `roll`. */
    optionsSchema: z.ZodType;
    /** Resuelve la tirada. Lanza RuleError si la jugada no es válida. */
    roll(sheet: S, movimientoId: string, opciones: unknown, ctx: RollContext): MoveResult;
  };

  progress?: {
    choiceSchema: z.ZodType;
    /** Lanza RuleError si no se puede aplicar. */
    apply(sheet: S, choice: unknown): S;
  };

  catalog?: CatalogDef<unknown>;
}

/** Ayuda de tipos para declarar un sistema con su tipo de hoja. */
export const defineSystem = <S>(s: GameSystem<S>): GameSystem<S> => s;

/** Nombre a mostrar de una hoja aunque su sistema no esté instalado. */
export function sheetDisplayName(system: GameSystem<any> | undefined, sheet: unknown): string {
  if (system) {
    try {
      const n = system.sheet.displayName(sheet);
      if (n) return n;
    } catch {
      /* hoja que no encaja: usa la alternativa */
    }
  }
  const n = sheet && typeof sheet === "object" ? (sheet as { nombre?: unknown }).nombre : undefined;
  return typeof n === "string" && n.trim() ? n : "¿?";
}

/** Minúsculas solo ASCII: el mismo criterio que `COLLATE NOCASE` y `lower()` de SQLite. */
export const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
