import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

type Row = Record<string, unknown>;

/** Subconjunto común de better-sqlite3 y node:sqlite (solo parámetros posicionales `?`). */
export interface Stmt {
  run(...params: unknown[]): { changes: number | bigint };
  get(...params: unknown[]): Row | undefined;
  all(...params: unknown[]): Row[];
}
export interface Db {
  exec(sql: string): void;
  prepare(sql: string): Stmt;
  close(): void;
}

/** Cada entrada es una migración; el índice+1 es la versión (PRAGMA user_version). */
const MIGRATIONS: string[] = [
  /* sql */ `
  CREATE TABLE partidas (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    descripcion TEXT NOT NULL DEFAULT '',
    imagen TEXT,
    activa INTEGER NOT NULL DEFAULT 0,
    escena_proyectada_id TEXT,
    edicion_libre_default INTEGER NOT NULL DEFAULT 0,
    musica TEXT NOT NULL,
    creada_en INTEGER NOT NULL
  );
  CREATE TABLE usuarios (
    id TEXT PRIMARY KEY,
    partida_id TEXT NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    password_hash TEXT,
    rol TEXT NOT NULL CHECK (rol IN ('narrador','jugador')),
    es_anfitrion INTEGER NOT NULL DEFAULT 0,
    UNIQUE (partida_id, nombre COLLATE NOCASE)
  );
  CREATE TABLE pjs (
    id TEXT PRIMARY KEY,
    partida_id TEXT NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
    dueno_id TEXT REFERENCES usuarios(id) ON DELETE SET NULL,
    imagen TEXT,
    edicion_libre INTEGER NOT NULL DEFAULT 0,
    sheet TEXT NOT NULL
  );
  CREATE TABLE npcs (
    id TEXT PRIMARY KEY,
    partida_id TEXT NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    imagen TEXT,
    notas TEXT NOT NULL DEFAULT '',
    oculto INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE hechizos (
    id TEXT PRIMARY KEY,
    partida_id TEXT NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    descripcion TEXT NOT NULL DEFAULT '',
    tipo TEXT NOT NULL,
    curso INTEGER NOT NULL,
    UNIQUE (partida_id, nombre COLLATE NOCASE, curso)
  );
  CREATE TABLE escenas (
    id TEXT PRIMARY KEY,
    partida_id TEXT NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('imagen','cuadricula')),
    imagen TEXT,
    filas INTEGER NOT NULL DEFAULT 10,
    columnas INTEGER NOT NULL DEFAULT 10,
    abierta INTEGER NOT NULL DEFAULT 1,
    orden INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE fichas (
    id TEXT PRIMARY KEY,
    escena_id TEXT NOT NULL REFERENCES escenas(id) ON DELETE CASCADE,
    partida_id TEXT NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
    ref_tipo TEXT NOT NULL CHECK (ref_tipo IN ('pj','npc')),
    ref_id TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    oculta INTEGER NOT NULL DEFAULT 0,
    UNIQUE (escena_id, ref_tipo, ref_id)
  );
  CREATE TABLE playlists (
    id TEXT PRIMARY KEY,
    partida_id TEXT NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL
  );
  CREATE TABLE pistas (
    id TEXT PRIMARY KEY,
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    partida_id TEXT NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    archivo TEXT NOT NULL,
    orden INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE materiales (
    id TEXT PRIMARY KEY,
    partida_id TEXT NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('nota','imagen','pdf')),
    titulo TEXT NOT NULL,
    contenido TEXT NOT NULL DEFAULT '',
    archivo TEXT,
    creador_id TEXT NOT NULL,
    seccion TEXT NOT NULL CHECK (seccion IN ('narrador','grupo')),
    visible_a_todos INTEGER NOT NULL DEFAULT 0,
    acceso TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE tiradas (
    id TEXT PRIMARY KEY,
    partida_id TEXT NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
    autor_id TEXT NOT NULL,
    visibilidad TEXT NOT NULL,
    creada_en INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX idx_tiradas_partida ON tiradas (partida_id, creada_en);
  CREATE INDEX idx_fichas_escena ON fichas (escena_id);
  `,
  /* sql */ `
  CREATE TABLE mensajes (
    id TEXT PRIMARY KEY,
    partida_id TEXT NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
    autor_id TEXT NOT NULL,
    destinatario_id TEXT,
    creada_en INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX idx_mensajes_partida ON mensajes (partida_id, creada_en);
  `,
  // Ciclo 4: cada Partida tiene un sistema de juego. Las que ya existían usaban las reglas de "pyv-clasico";
  // las nuevas eligen (por defecto, el genérico). El catálogo de hechizos pasa a una tabla genérica por sistema:
  // se COPIA desde `hechizos` (que no se toca, por seguridad). La clave repite la unicidad antigua (nombre NOCASE + curso).
  /* sql */ `
  ALTER TABLE partidas ADD COLUMN sistema TEXT NOT NULL DEFAULT 'generico';
  UPDATE partidas SET sistema = 'pyv-clasico';
  CREATE TABLE catalogo (
    id TEXT PRIMARY KEY,
    partida_id TEXT NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
    sistema TEXT NOT NULL,
    clave TEXT NOT NULL,
    data TEXT NOT NULL,
    UNIQUE (partida_id, sistema, clave)
  );
  INSERT OR IGNORE INTO catalogo (id, partida_id, sistema, clave, data)
    SELECT id, partida_id, 'pyv-clasico', lower(trim(nombre)) || '|' || curso,
           json_object('nombre', nombre, 'descripcion', descripcion, 'tipo', tipo, 'curso', curso)
    FROM hechizos ORDER BY rowid;
  `,
];

/** Aplica las migraciones pendientes. `target` (solo pruebas) para en esa versión. */
export function migrate(db: Db, target = MIGRATIONS.length): void {
  const current = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  for (let v = current; v < target; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v] as string);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}

/** Abre SQLite con `node:sqlite` (incluido en Node 22.5+; no requiere compilar nada). */
export function openDb(file: string): Db {
  mkdirSync(dirname(file), { recursive: true });
  const require = createRequire(import.meta.url);
  let DatabaseSync: new (f: string) => Db;
  try {
    ({ DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (f: string) => Db });
  } catch (e) {
    throw new Error(`Esta versión de Node no incluye node:sqlite (se necesita Node 22.5 o superior): ${String(e)}`);
  }
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

/** Transacción síncrona (better-sqlite3 y node:sqlite no comparten API de transacciones). */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
