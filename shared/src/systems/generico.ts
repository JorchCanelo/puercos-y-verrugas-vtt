// Sistema genérico: el que trae el VTT base. Sin reglas: nombre, notas y campos libres de texto (nombre: valor).
// Las tiradas se hacen con los dados libres (panel o chat: /r 2d6+1).
import { z } from "zod";
import { defineSystem } from "../system";
import { patchOf } from "../patch";

const text = (max: number) => z.string().trim().max(max);

export const GENERIC_FIELDS_MAX = 100;

export const GenericFieldSchema = z.object({
  id: z.string().min(1).max(64),
  nombre: text(80),
  valor: text(2000).default(""),
});
export type GenericField = z.infer<typeof GenericFieldSchema>;

export const GenericSheetSchema = z.object({
  nombre: text(80).min(1),
  notas: text(20_000).default(""),
  campos: z.array(GenericFieldSchema).max(GENERIC_FIELDS_MAX).default([]),
});
export type GenericSheet = z.infer<typeof GenericSheetSchema>;

export const GENERIC_SYSTEM_ID = "generico";

export const genericoSystem = defineSystem<GenericSheet>({
  id: GENERIC_SYSTEM_ID,
  nombre: "Genérico (hoja libre)",
  version: "1.0.0",
  sheet: {
    schema: GenericSheetSchema,
    patchSchema: patchOf(GenericSheetSchema),
    empty: (nombre) => ({ nombre, notas: "", campos: [] }),
    displayName: (s) => s.nombre,
    // Sin edición libre el jugador cambia notas y campos; el nombre (y la imagen) los decide el Narrador.
    playerSafeKeys: ["notas", "campos"],
    normalize(sheet, newId) {
      const seen = new Set<string>();
      const campos = sheet.campos.map((c) => {
        const id = seen.has(c.id) ? newId() : c.id;
        seen.add(id);
        return id === c.id ? c : { ...c, id };
      });
      return { ...sheet, campos };
    },
  },
});
