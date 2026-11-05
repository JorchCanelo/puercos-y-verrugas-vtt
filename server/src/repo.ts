import { sheetDisplayName, type GameSystem, type SystemRegistry } from "@pyv/shared";
import type {
  CatalogoDto,
  EscenaDto,
  FichaDto,
  MaterialDto,
  MusicState,
  NpcDto,
  PartidaDto,
  PistaDto,
  PjDto,
  PlaylistDto,
  MensajeDto,
  TiradaDto,
  UsuarioDto,
} from "@pyv/shared";
import type { Db } from "./db";
import { notFound } from "./errors";

type Row = Record<string, unknown>;
const s = (v: unknown) => v as string;
const sn = (v: unknown) => (v ?? null) as string | null;
const n = (v: unknown) => Number(v);
const bool = (v: unknown) => Number(v) === 1;

// --- mapeadores fila → DTO ---------------------------------------------------

export function partidaDto(r: Row, systems: SystemRegistry): PartidaDto {
  const system = systems.get(s(r.sistema));
  return {
    id: s(r.id),
    nombre: s(r.nombre),
    descripcion: s(r.descripcion),
    imagen: sn(r.imagen),
    activa: bool(r.activa),
    edicionLibreDefault: bool(r.edicion_libre_default),
    sistema: s(r.sistema),
    sistemaNombre: system?.nombre ?? s(r.sistema),
    sistemaDisponible: system !== undefined,
  };
}

export const usuarioDto = (r: Row): UsuarioDto => ({
  id: s(r.id),
  nombre: s(r.nombre),
  rol: s(r.rol) as UsuarioDto["rol"],
  esAnfitrion: bool(r.es_anfitrion),
});

/** `system` = el de la Partida (undefined si no está instalado): solo se usa para el nombre. La hoja va tal cual. */
export function pjDto(r: Row, system: GameSystem<any> | undefined): PjDto {
  const sheet: unknown = JSON.parse(s(r.sheet));
  return {
    id: s(r.id),
    nombre: sheetDisplayName(system, sheet),
    duenoId: sn(r.dueno_id),
    imagen: sn(r.imagen),
    edicionLibre: bool(r.edicion_libre),
    sheet,
  };
}

export const npcDto = (r: Row): NpcDto => ({
  id: s(r.id),
  nombre: s(r.nombre),
  imagen: sn(r.imagen),
  notas: s(r.notas),
  oculto: bool(r.oculto),
});

export const escenaDto = (r: Row): EscenaDto => ({
  id: s(r.id),
  nombre: s(r.nombre),
  tipo: s(r.tipo) as EscenaDto["tipo"],
  imagen: sn(r.imagen),
  filas: n(r.filas),
  columnas: n(r.columnas),
  abierta: bool(r.abierta),
  orden: n(r.orden),
});

export const catalogoDto = (r: Row): CatalogoDto => ({ id: s(r.id), data: JSON.parse(s(r.data)) as unknown });

export const materialDto = (r: Row): MaterialDto => ({
  id: s(r.id),
  tipo: s(r.tipo) as MaterialDto["tipo"],
  titulo: s(r.titulo),
  contenido: s(r.contenido),
  archivo: sn(r.archivo),
  creadorId: s(r.creador_id),
  seccion: s(r.seccion) as MaterialDto["seccion"],
  visibleATodos: bool(r.visible_a_todos),
  acceso: JSON.parse(s(r.acceso)) as MaterialDto["acceso"],
});

export const pistaDto = (r: Row): PistaDto => ({ id: s(r.id), nombre: s(r.nombre), archivo: s(r.archivo) });

export const tiradaDto = (r: Row): TiradaDto => JSON.parse(s(r.data)) as TiradaDto;
export const mensajeDto = (r: Row): MensajeDto => JSON.parse(s(r.data)) as MensajeDto;

// --- consultas ---------------------------------------------------------------

export function getPartidaRow(db: Db, id: string): Row {
  const r = db.prepare("SELECT * FROM partidas WHERE id = ?").get(id);
  if (!r) throw notFound("Partida no encontrada");
  return r;
}

export function getUsuarioRow(db: Db, partidaId: string, id: string): Row {
  const r = db.prepare("SELECT * FROM usuarios WHERE id = ? AND partida_id = ?").get(id, partidaId);
  if (!r) throw notFound("Usuario no encontrado");
  return r;
}

export function getPjRow(db: Db, partidaId: string, id: string): Row {
  const r = db.prepare("SELECT * FROM pjs WHERE id = ? AND partida_id = ?").get(id, partidaId);
  if (!r) throw notFound("Personaje no encontrado");
  return r;
}

export function getNpcRow(db: Db, partidaId: string, id: string): Row {
  const r = db.prepare("SELECT * FROM npcs WHERE id = ? AND partida_id = ?").get(id, partidaId);
  if (!r) throw notFound("NPC no encontrado");
  return r;
}

export function getEscenaRow(db: Db, partidaId: string, id: string): Row {
  const r = db.prepare("SELECT * FROM escenas WHERE id = ? AND partida_id = ?").get(id, partidaId);
  if (!r) throw notFound("Escena no encontrada");
  return r;
}

export function getFichaRow(db: Db, partidaId: string, id: string): Row {
  const r = db.prepare("SELECT * FROM fichas WHERE id = ? AND partida_id = ?").get(id, partidaId);
  if (!r) throw notFound("Ficha no encontrada");
  return r;
}

export function getMaterialRow(db: Db, partidaId: string, id: string): Row {
  const r = db.prepare("SELECT * FROM materiales WHERE id = ? AND partida_id = ?").get(id, partidaId);
  if (!r) throw notFound("Material no encontrado");
  return r;
}

export function getMusic(db: Db, partidaId: string): MusicState {
  return JSON.parse(s(getPartidaRow(db, partidaId).musica)) as MusicState;
}

/** Convierte filas de fichas a DTO resolviendo nombre e imagen del PJ/NPC (nunca la hoja). */
export function fichasDto(db: Db, partidaId: string, rows: Row[], system: GameSystem<any> | undefined): FichaDto[] {
  if (rows.length === 0) return [];
  const pjs = new Map<string, { nombre: string; imagen: string | null }>();
  for (const r of db.prepare("SELECT id, imagen, sheet FROM pjs WHERE partida_id = ?").all(partidaId)) {
    pjs.set(s(r.id), { nombre: sheetDisplayName(system, JSON.parse(s(r.sheet))), imagen: sn(r.imagen) });
  }
  const npcs = new Map<string, { nombre: string; imagen: string | null }>();
  for (const r of db.prepare("SELECT id, nombre, imagen FROM npcs WHERE partida_id = ?").all(partidaId)) {
    npcs.set(s(r.id), { nombre: s(r.nombre), imagen: sn(r.imagen) });
  }
  return rows.map((r) => {
    const info = (r.ref_tipo === "pj" ? pjs : npcs).get(s(r.ref_id));
    return {
      id: s(r.id),
      escenaId: s(r.escena_id),
      ref: { tipo: s(r.ref_tipo) as "pj" | "npc", id: s(r.ref_id) },
      nombre: info?.nombre ?? "¿?",
      imagen: info?.imagen ?? null,
      x: n(r.x),
      y: n(r.y),
      oculta: bool(r.oculta),
    };
  });
}

export function playlistsDto(db: Db, partidaId: string): PlaylistDto[] {
  const pistas = db.prepare("SELECT * FROM pistas WHERE partida_id = ? ORDER BY orden, rowid").all(partidaId);
  return db
    .prepare("SELECT * FROM playlists WHERE partida_id = ? ORDER BY rowid")
    .all(partidaId)
    .map((p) => ({
      id: s(p.id),
      nombre: s(p.nombre),
      pistas: pistas.filter((x) => x.playlist_id === p.id).map(pistaDto),
    }));
}

export function getPista(db: Db, partidaId: string, id: string): PistaDto | null {
  const r = db.prepare("SELECT * FROM pistas WHERE id = ? AND partida_id = ?").get(id, partidaId);
  return r ? pistaDto(r) : null;
}
