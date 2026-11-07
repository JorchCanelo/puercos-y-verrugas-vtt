import type { RollTone } from "./system";

export type Role = "narrador" | "jugador";

export interface PartidaDto {
  id: string;
  nombre: string;
  descripcion: string;
  imagen: string | null;
  activa: boolean;
  edicionLibreDefault: boolean;
  /** Id del sistema de juego de la Partida. */
  sistema: string;
  /** Nombre del sistema (o el id, si no está instalado). */
  sistemaNombre: string;
  /** false = el sistema no está instalado en este VTT: las hojas se ven pero no se pueden modificar. */
  sistemaDisponible: boolean;
}

/** Sistema de juego instalado (para elegirlo al crear una Partida). */
export interface SistemaInfoDto {
  id: string;
  nombre: string;
  version: string;
}

export interface UsuarioDto {
  id: string;
  nombre: string;
  rol: Role;
  esAnfitrion: boolean;
}

/** `S` = tipo de hoja del sistema de la Partida. El núcleo no la interpreta (`unknown`). */
export interface PjDto<S = unknown> {
  id: string;
  /** Nombre del personaje según su sistema (calculado por el servidor). */
  nombre: string;
  duenoId: string | null;
  imagen: string | null;
  /** Si es true, el jugador dueño edita su hoja igual que el Narrador. */
  edicionLibre: boolean;
  sheet: S;
}

export interface NpcDto {
  id: string;
  nombre: string;
  imagen: string | null;
  notas: string;
  /** "" = sin carpeta. */
  carpeta: string;
  /** Permisos de los jugadores. Un jugador solo recibe los NPCs en los que tiene permiso, y solo su propia entrada. */
  acceso: Acceso[];
}

export type SceneType = "imagen" | "cuadricula";

export interface EscenaDto {
  id: string;
  nombre: string;
  tipo: SceneType;
  imagen: string | null;
  filas: number;
  columnas: number;
  /** "Abierta" = en las pestañas del Narrador. Los jugadores solo ven la proyectada. */
  abierta: boolean;
  orden: number;
}

export interface FichaDto {
  id: string;
  escenaId: string;
  ref: { tipo: "pj" | "npc"; id: string };
  nombre: string;
  imagen: string | null;
  /** Escena libre: 0..1 sobre la imagen. Cuadrícula: índice de columna (entero). */
  x: number;
  /** Escena libre: 0..1 sobre la imagen. Cuadrícula: índice de fila (entero). */
  y: number;
  oculta: boolean;
}

/** Entrada del catálogo de la Partida (su forma la define el sistema; p. ej. hechizos). */
export interface CatalogoDto<E = unknown> {
  id: string;
  data: E;
}

export type Visibilidad = "publica" | "narradores" | "autor_narradores";

export interface TiradaDto {
  id: string;
  autorId: string;
  autorNombre: string;
  pjId: string | null;
  pjNombre: string | null;
  tipo: "movimiento" | "libre";
  movimientoId: string | null;
  movimientoNombre: string | null;
  /** Hechizo u objeto elegido (texto libre para el registro). */
  detalle: string | null;
  /** Id de la estadística (según el sistema). */
  stat: string | null;
  /** Nombre de la estadística para mostrar (las tiradas anteriores al ciclo 4 no lo traen). */
  statEtiqueta?: string | null;
  caras: number;
  dados: number[];
  modificador: number;
  total: number;
  /** Id del resultado según el sistema (p. ej. "exito"). */
  resultado: string | null;
  resultadoEtiqueta?: string | null;
  resultadoTono?: RollTone | null;
  visibilidad: Visibilidad;
  creadaEn: number;
}

/** Mensaje del chat. Si tiene destinatario es un susurro: solo lo ven su autor y su destinatario (ni siquiera los Narradores). */
export interface MensajeDto {
  id: string;
  autorId: string;
  /** Nombre de usuario del autor. */
  autorNombre: string;
  /** Nombre con el que se muestra: el del PJ elegido o, si no, el nombre de usuario. */
  remitenteNombre: string;
  pjId: string | null;
  destinatarioId: string | null;
  destinatarioNombre: string | null;
  texto: string;
  creadaEn: number;
}

export interface PistaDto {
  id: string;
  nombre: string;
  archivo: string;
}

export interface PlaylistDto {
  id: string;
  nombre: string;
  pistas: PistaDto[];
}

export interface MusicState {
  pistaId: string | null;
  reproduciendo: boolean;
  /** Posición en el instante `actualizadoEn`. */
  posicionMs: number;
  /** Reloj del servidor (ms epoch) al fijar el estado. */
  actualizadoEn: number;
}

export interface MusicDto extends MusicState {
  pista: PistaDto | null;
}

export type MaterialType = "nota" | "imagen" | "pdf";
export type MaterialSection = "narrador" | "grupo";

/**
 * Permiso de un jugador sobre un NPC o un material (sin entrada = «Ninguno»; los Narradores siempre tienen todo).
 *  · "observador": ve todos sus datos.
 *  · "propietario": además edita y borra (NPC: nombre, imagen y notas, y maneja su ficha como la de su PJ;
 *    material: edita el texto, lo borra, decide quién lo ve y lo mueve de carpeta).
 */
export interface Acceso {
  usuarioId: string;
  nivel: "observador" | "propietario";
}
export type MaterialAcceso = Acceso;

export interface MaterialDto {
  id: string;
  tipo: MaterialType;
  titulo: string;
  contenido: string;
  archivo: string | null;
  creadorId: string;
  seccion: MaterialSection;
  visibleATodos: boolean;
  acceso: MaterialAcceso[];
  /** Carpeta en la que la organizó quien puede compartirla ("" = sin carpeta). */
  carpeta: string;
}

/** Estado completo filtrado por rol. Fuente de verdad para (re)conexión. */
export interface Snapshot {
  yo: UsuarioDto;
  partida: PartidaDto;
  usuarios: UsuarioDto[];
  conectados: string[];
  pjs: PjDto[];
  npcs: NpcDto[];
  /** Narrador: todas las abiertas. Jugador: solo la proyectada. */
  escenas: EscenaDto[];
  escenaProyectadaId: string | null;
  /** Tokens de PJs ajenos: solo nombre/imagen, nunca la hoja. */
  fichas: FichaDto[];
  /** Catálogo de la Partida (del sistema; vacío si no tiene). */
  catalogo: CatalogoDto[];
  tiradas: TiradaDto[];
  /** Chat visible para este usuario (público + susurros enviados o recibidos), cronológico. */
  mensajes: MensajeDto[];
  playlists: PlaylistDto[];
  musica: MusicDto;
  materiales: MaterialDto[];
  serverNow: number;
}
