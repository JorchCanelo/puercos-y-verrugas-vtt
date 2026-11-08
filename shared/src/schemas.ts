import { z } from "zod";
import { FREE_DICE_MAX, FREE_MOD_MAX, FREE_MOD_MIN, isDiceSides } from "./freeDice";
import { patchOf } from "./patch";

const name = z.string().trim().min(1).max(80);
const longText = z.string().max(20_000);
/** Permisos de jugadores sobre un NPC o un material (ver `Acceso`). */
const acceso = z.array(z.object({ usuarioId: z.string(), nivel: z.enum(["observador", "propietario"]) })).max(100);
/** Carpeta para organizar NPCs y materiales ("" = sin carpeta). */
const carpeta = z.string().trim().max(60);
/** Id de un sistema de juego (ver system.ts). */
export const systemId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "id de sistema no válido");
const archivo = z.string().regex(/^[A-Za-z0-9_-]+\.[a-z0-9]{2,5}$/).nullable();

export const LoginBody = z.object({ partidaId: z.string().min(1), nombre: z.string().min(1).max(80), password: z.string().min(1).max(200) });
export const HostExchangeBody = z.object({ token: z.string().min(10).max(200) });

export const CreatePartidaBody = z.object({
  nombre: name,
  descripcion: z.string().max(2000).default(""),
  /** Nombre del Narrador anfitrión (entra sin contraseña). */
  anfitrionNombre: name,
  /** Sistema de juego; si se omite, el genérico. */
  sistema: systemId.optional(),
});
export const PatchPartidaBody = z.object({
  nombre: name.optional(),
  descripcion: z.string().max(2000).optional(),
  imagen: archivo.optional(),
  edicionLibreDefault: z.boolean().optional(),
  /** Solo se puede cambiar mientras la Partida no tenga PJs. */
  sistema: systemId.optional(),
});

export const CreateUserBody = z.object({
  nombre: name,
  password: z.string().min(4).max(200),
  rol: z.enum(["narrador", "jugador"]),
});
export const SetPasswordBody = z.object({ password: CreateUserBody.shape.password });

/** La hoja la valida el servidor con el sistema de la Partida. */
const sheetObject = z.record(z.string(), z.unknown());

export const CreatePjBody = z.object({
  sheet: sheetObject,
  imagen: archivo.optional(),
  /** Solo el Narrador puede asignar dueño. */
  duenoId: z.string().nullable().optional(),
});
export const PatchPjBody = z.object({
  /** Claves de primer nivel de la hoja a reemplazar (el servidor las valida con el sistema). */
  sheet: sheetObject.optional(),
  imagen: archivo.optional(),
  duenoId: z.string().nullable().optional(),
  edicionLibre: z.boolean().optional(),
});

export const NpcBody = z.object({
  nombre: name,
  imagen: archivo.optional(),
  notas: longText.default(""),
  carpeta: carpeta.default(""),
  acceso: acceso.default([]),
});
export const PatchNpcBody = patchOf(NpcBody);

export const EscenaBody = z.object({
  nombre: name,
  tipo: z.enum(["imagen", "cuadricula"]),
  imagen: archivo.optional(),
  filas: z.number().int().min(1).max(200).default(10),
  columnas: z.number().int().min(1).max(200).default(10),
  abierta: z.boolean().default(true),
});
export const PatchEscenaBody = patchOf(EscenaBody).extend({ orden: z.number().int().optional() });

export const CreateFichaBody = z.object({
  ref: z.object({ tipo: z.enum(["pj", "npc"]), id: z.string() }),
  x: z.number(),
  y: z.number(),
  oculta: z.boolean().default(false),
});
export const PatchFichaBody = z.object({ x: z.number().optional(), y: z.number().optional(), oculta: z.boolean().optional() });

export const MoveRollBody = z.object({
  pjId: z.string(),
  movimientoId: z.string().min(1).max(64),
  /** Elecciones del movimiento (estadística, hechizo…): las valida el sistema de la Partida. */
  opciones: z.unknown().optional(),
  privada: z.boolean().default(false),
});
/** Tirada libre (cualquier usuario): `cantidad`d`caras` + `modificador`. */
export const FreeRollBody = z.object({
  cantidad: z.number().int().min(1).max(FREE_DICE_MAX),
  caras: z.number().int().refine(isDiceSides, "dado no permitido"),
  modificador: z.number().int().min(FREE_MOD_MIN).max(FREE_MOD_MAX).default(0),
  privada: z.boolean().default(true),
});

export const ChatBody = z.object({
  texto: z.string().trim().min(1).max(2000),
  /** PJ con el que se habla; null/omitido = el nombre de usuario. */
  pjId: z.string().nullable().optional(),
  /** Susurro para esta persona; null/omitido = mensaje público. */
  destinatarioId: z.string().nullable().optional(),
});

export const MaterialBody = z.object({
  tipo: z.enum(["nota", "imagen", "pdf"]),
  titulo: name,
  contenido: longText.default(""),
  archivo: archivo.optional(),
  seccion: z.enum(["narrador", "grupo"]),
  /** Si se omite: las Notas de grupo son visibles para todos; las del Narrador, solo para quien se asigne. */
  visibleATodos: z.boolean().optional(),
  acceso: acceso.default([]),
  carpeta: carpeta.default(""),
});
export const PatchMaterialBody = z.object({
  titulo: name.optional(),
  contenido: longText.optional(),
  visibleATodos: z.boolean().optional(),
  acceso: MaterialBody.shape.acceso.optional(),
  carpeta: carpeta.optional(),
});

export const PlaylistBody = z.object({ nombre: name });
export const PistaBody = z.object({ nombre: name, archivo: z.string().regex(/^[A-Za-z0-9_-]+\.[a-z0-9]{2,5}$/) });
export const MusicBody = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("play"), pistaId: z.string().optional(), posicionMs: z.number().min(0).optional() }),
  z.object({ accion: z.literal("pause") }),
  z.object({ accion: z.literal("seek"), posicionMs: z.number().min(0) }),
  z.object({ accion: z.literal("stop") }),
]);
