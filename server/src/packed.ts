// Módulos empaquetados (.pyvmod) de <data>/modulos: se cargan al arrancar (instalar o quitar uno pide reiniciar).
// Así la versión instalada del VTT, que no puede compilar código, admite sistemas de juego.
// Los módulos de modules/ (código fuente) siguen compilándose dentro del VTT y tienen prioridad.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import * as shared from "@pyv/shared";
import * as zod from "zod";
import {
  GENERIC_SYSTEM_ID,
  PACKED_MODULE_EXT,
  PYV_MODULE_API,
  PackedModuleSchema,
  type GameSystem,
  type ModuloDto,
  type ModulosClienteDto,
  type ModulosDto,
  type PackedModule,
} from "@pyv/shared";
import { buildModuleCss } from "./moduleCss";

/** Nombre de archivo admitido en la carpeta de módulos. */
export const PACKED_FILE_RE = /^[\w.() -]{1,120}\.pyvmod$/i;

export interface LoadedPacked {
  dir: string;
  /** Sistemas de los paquetes que se cargaron bien. */
  systems: GameSystem<any>[];
  /** Estado de cada archivo al arrancar. */
  arranque: ModuloDto[];
  /** Interfaz de cada paquete cargado, por id. `hash` va en la URL para que el navegador no use una versión vieja. */
  ui: Map<string, { js: string; hash: string }>;
  css: { text: string; hash: string } | null;
}

interface Logger {
  log(msg: string): void;
  warn(msg: string): void;
}

const hashOf = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** Lee y valida un .pyvmod. Lanza Error con un mensaje para el anfitrión. */
export function parsePacked(buf: Buffer): PackedModule {
  let json: unknown;
  try {
    json = JSON.parse(gunzipSync(buf, { maxOutputLength: 64 * 1024 * 1024 }).toString("utf8"));
  } catch {
    throw new Error("No es un archivo de módulo válido (.pyvmod)");
  }
  const r = PackedModuleSchema.safeParse(json);
  if (!r.success) throw new Error("El archivo del módulo está incompleto o dañado");
  return r.data;
}

/** Motivo por el que este VTT no puede usar el paquete, o null. */
export function incompatibility(m: Pick<PackedModule, "id" | "pyvApi">): string | null {
  if (m.id === GENERIC_SYSTEM_ID) return `"${GENERIC_SYSTEM_ID}" es el sistema del VTT base`;
  if (m.pyvApi !== PYV_MODULE_API)
    return `Empaquetado para la versión ${m.pyvApi} de la API de módulos; este VTT usa la ${PYV_MODULE_API}. ${
      m.pyvApi < PYV_MODULE_API ? "Pide una versión nueva del módulo." : "Actualiza el VTT."
    }`;
  return null;
}

export interface PackedFile {
  archivo: string;
  modulo: PackedModule | null;
  error: string | null;
}

/** Archivos .pyvmod de la carpeta, en orden alfabético. */
export function scanPacked(dir: string): PackedFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(PACKED_MODULE_EXT))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
    .map((archivo) => {
      try {
        return { archivo, modulo: parsePacked(readFileSync(join(dir, archivo))), error: null };
      } catch (e) {
        return { archivo, modulo: null, error: (e as Error).message };
      }
    });
}

function isSystem(x: unknown, id: string): x is GameSystem<any> {
  const s = x as GameSystem<any> | undefined;
  return !!s && s.id === id && typeof s.nombre === "string" && !!s.sheet?.schema && !!s.sheet?.patchSchema && typeof s.sheet.displayName === "function";
}

/**
 * Carga los paquetes de `dir`. Un paquete roto o incompatible no impide arrancar: queda con su estado y su
 * detalle para el panel del anfitrión. `sourceIds`: ids ya instalados como código fuente (modules/), que ganan.
 */
export async function loadPacked(dir: string, sourceIds: ReadonlySet<string>, logger: Logger = console): Promise<LoadedPacked> {
  const out: LoadedPacked = { dir, systems: [], arranque: [], ui: new Map(), css: null };
  const files = scanPacked(dir);
  if (!files.length) return out;

  // Lo que el código del servidor de un paquete importa del VTT (ver scripts/pack-module.mjs).
  (globalThis as Record<string, unknown>).__PYV_SERVER__ = { "@pyv/shared": shared, zod };

  const clases: string[] = [];
  for (const f of files) {
    const base = { origen: "paquete" as const, archivo: f.archivo };
    const m = f.modulo;
    if (!m) {
      out.arranque.push({ ...base, id: null, nombre: f.archivo, version: null, estado: "error", detalle: f.error });
      continue;
    }
    const info = { ...base, id: m.id, nombre: m.nombre, version: m.version };
    const incompatible = incompatibility(m);
    if (incompatible) {
      out.arranque.push({ ...info, estado: "incompatible", detalle: incompatible });
      continue;
    }
    if (sourceIds.has(m.id)) {
      out.arranque.push({ ...info, estado: "duplicado", detalle: "Ya está instalado como código fuente en modules/; se usa ese" });
      continue;
    }
    const other = out.arranque.find((x) => x.id === m.id && x.estado === "cargado");
    if (other) {
      out.arranque.push({ ...info, estado: "duplicado", detalle: `El archivo ${other.archivo} ya trae este módulo` });
      continue;
    }
    try {
      const code = `data:text/javascript;base64,${Buffer.from(m.servidor, "utf8").toString("base64")}`;
      const mod = (await import(code)) as { system?: unknown };
      if (!isSystem(mod.system, m.id)) throw new Error(`no exporta un sistema de juego con id "${m.id}"`);
      out.systems.push(mod.system);
      out.ui.set(m.id, { js: m.interfaz, hash: hashOf(m.interfaz) });
      clases.push(...m.clases);
      out.arranque.push({ ...info, estado: "cargado", detalle: null });
      logger.log(`[módulos] Paquete cargado: ${m.nombre} ${m.version} (${f.archivo})`);
    } catch (e) {
      const detalle = `No se pudo cargar: ${(e as Error).message}`;
      out.arranque.push({ ...info, estado: "error", detalle });
    }
  }
  for (const x of out.arranque) if (x.estado !== "cargado") logger.warn(`[módulos] ${x.archivo}: ${x.detalle}`);

  if (out.systems.length) {
    try {
      const text = await buildModuleCss(clases);
      out.css = { text, hash: hashOf(text) };
    } catch (e) {
      logger.warn(`[módulos] No se pudieron generar los estilos de los paquetes: ${(e as Error).message}`);
    }
  }
  return out;
}

/** Lo que el navegador necesita para cargar las interfaces de los paquetes. */
export function clientInfo(p: LoadedPacked | undefined): ModulosClienteDto {
  if (!p) return { estilos: null, modulos: [] };
  return {
    estilos: p.css ? `/modulos/estilos.css?v=${p.css.hash}` : null,
    modulos: [...p.ui].map(([id, u]) => ({ id, url: `/modulos/${id}/${u.hash}.js` })),
  };
}

/**
 * Estado para el panel del anfitrión: lo cargado al arrancar comparado con lo que hay ahora en la carpeta
 * (instalado/quitado desde el panel o copiado a mano), para avisar de que hace falta reiniciar.
 */
export function moduleStatus(p: LoadedPacked, source: readonly GameSystem<any>[]): ModulosDto {
  const modulos: ModuloDto[] = source.map((s) => ({
    origen: "codigo",
    archivo: null,
    id: s.id,
    nombre: s.nombre,
    version: s.version,
    estado: "cargado",
    detalle: "Código fuente en modules/",
  }));
  const sourceIds = new Set(source.map((s) => s.id));
  const disk = scanPacked(p.dir);
  const loadedIds = new Set(p.arranque.filter((x) => x.estado === "cargado").map((x) => x.id));

  for (const f of disk) {
    const before = p.arranque.find((x) => x.archivo === f.archivo);
    const m = f.modulo;
    if (before && m && before.id === m.id && before.version === m.version) {
      modulos.push(before);
      continue;
    }
    const base = { origen: "paquete" as const, archivo: f.archivo };
    if (!m) {
      modulos.push({ ...base, id: null, nombre: f.archivo, version: null, estado: "error", detalle: f.error });
      continue;
    }
    const info = { ...base, id: m.id, nombre: m.nombre, version: m.version };
    const incompatible = incompatibility(m);
    if (incompatible) modulos.push({ ...info, estado: "incompatible", detalle: incompatible });
    else if (sourceIds.has(m.id)) modulos.push({ ...info, estado: "duplicado", detalle: "Ya está instalado como código fuente en modules/; se usa ese" });
    else if (loadedIds.has(m.id)) modulos.push({ ...info, estado: "actualizar", detalle: "Reinicia el VTT para usar esta versión" });
    else modulos.push({ ...info, estado: "pendiente", detalle: "Reinicia el VTT para activarlo" });
  }
  // Cargados al arrancar cuyo archivo ya no está (o ya no trae ese módulo).
  for (const x of p.arranque) {
    if (x.estado !== "cargado") continue;
    if (modulos.some((y) => y.origen === "paquete" && y.id === x.id && y.estado !== "duplicado")) continue;
    modulos.push({ ...x, estado: "quitar", detalle: "Sigue activo hasta que reinicies el VTT" });
  }
  return {
    carpeta: p.dir,
    modulos,
    reinicioPendiente: modulos.some((x) => x.estado === "pendiente" || x.estado === "actualizar" || x.estado === "quitar"),
  };
}
