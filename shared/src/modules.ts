// Módulos empaquetados (.pyvmod): lo que necesita la versión instalada del VTT, que no puede compilar módulos.
// Un .pyvmod es un JSON comprimido con gzip que trae ya compilados la parte del servidor, la de la interfaz y
// las clases de Tailwind que usa. Lo genera `npm run pack-module -- <carpeta>` (scripts/pack-module.mjs).
import { z } from "zod";

/**
 * Versión de lo que el VTT ofrece a los módulos empaquetados: las interfaces `GameSystem` y `SystemUi`,
 * `@pyv/shared`, `@pyv/client/sdk`, React y zod. Súbela cuando cambien de forma incompatible: los módulos
 * empaquetados para otra versión no se cargan (el panel lo avisa).
 */
export const PYV_MODULE_API = 1;

export const MODULE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const PACKED_MODULE_EXT = ".pyvmod";

export const PackedModuleSchema = z.object({
  formato: z.literal(1),
  id: z.string().regex(MODULE_ID_RE),
  nombre: z.string().trim().min(1).max(120),
  version: z.string().trim().min(1).max(40),
  descripcion: z.string().max(1000).default(""),
  /** Versión de la API de módulos para la que se empaquetó (ver PYV_MODULE_API). */
  pyvApi: z.number().int().positive(),
  /** ESM sin imports externos salvo `globalThis.__PYV_SERVER__`: exporta `system`. */
  servidor: z.string().min(1),
  /** ESM sin imports externos salvo `globalThis.__PYV_CLIENT__`: exporta `ui`. */
  interfaz: z.string().min(1),
  /** Palabras con forma de clase de Tailwind sacadas del código del módulo. */
  clases: z.array(z.string().max(200)).max(50_000).default([]),
});
export type PackedModule = z.infer<typeof PackedModuleSchema>;

/**
 * Estado de un módulo en el panel del anfitrión. Los paquetes se cargan al arrancar, así que instalar, actualizar o
 * quitar uno queda "pendiente" hasta reiniciar.
 */
export type ModuloEstado = "cargado" | "pendiente" | "actualizar" | "quitar" | "incompatible" | "duplicado" | "error";

export interface ModuloDto {
  /** "codigo": carpeta en modules/ compilada dentro del VTT. "paquete": archivo .pyvmod. */
  origen: "codigo" | "paquete";
  /** Nombre del archivo .pyvmod (solo paquetes). */
  archivo: string | null;
  id: string | null;
  nombre: string;
  version: string | null;
  estado: ModuloEstado;
  detalle: string | null;
}

export interface ModulosDto {
  /** Carpeta donde se instalan los .pyvmod (también se pueden copiar ahí a mano). */
  carpeta: string;
  modulos: ModuloDto[];
  /** Hay cambios que se aplican al reiniciar el VTT. */
  reinicioPendiente: boolean;
}

/** Lo que el navegador necesita para cargar las interfaces de los paquetes. */
export interface ModulosClienteDto {
  estilos: string | null;
  modulos: { id: string; url: string }[];
}
