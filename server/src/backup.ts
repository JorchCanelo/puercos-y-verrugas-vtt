// Copia de los datos de la mesa (descargar / restaurar), para llevar una mesa entre la versión local y un servidor
// y como respaldo. Formato: un .tar.gz (extensión .pyvbak) escrito y leído aquí mismo, sin dependencias:
//   pyv-copia.json               manifiesto {formato, app, creada}
//   vtt.sqlite                   copia consistente de la base de datos (VACUUM INTO, aunque esté en uso)
//   secret.key                   secreto de las sesiones
//   partidas/<id>/archivos/<f>   archivos subidos
//   modulos/<f>.pyvmod           módulos empaquetados
// Restaurar NO toca la mesa en uso: deja la copia preparada en <datos>/.restaurar y se aplica al reiniciar
// (los datos anteriores quedan en <datos>/.anterior por si hiciera falta volver atrás).
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, stat, statfs, writeFile, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import type { Db } from "./db";
import { PACKED_FILE_RE } from "./packed";
import { FILE_NAME_RE } from "./uploads";

export const BACKUP_FORMAT = 1;
export const BACKUP_EXT = ".pyvbak";
export const MANIFEST = "pyv-copia.json";
/** Copia preparada para aplicarse al reiniciar. */
export const PENDING_DIR = ".restaurar";
/** Datos que había antes de la última restauración. */
export const PREVIOUS_DIR = ".anterior";
/** Si al arrancar existe este archivo en la carpeta de datos, se restaura (útil para copiarlo con scp a un servidor). */
export const RESTORE_FILE = `restaurar${BACKUP_EXT}`;
const READY = "LISTO";
/** Lo que forma "los datos de la mesa" (lo que se mueve a .anterior al restaurar). */
const DATA_ITEMS = ["vtt.sqlite", "vtt.sqlite-wal", "vtt.sqlite-shm", "secret.key", "partidas", "modulos"];

export class BackupError extends Error {}

const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

/** Rutas que puede contener una copia. Cualquier otra (o con "..", absolutas, etc.) se rechaza al restaurar. */
export function isBackupPath(name: string): boolean {
  if (name === MANIFEST || name === "vtt.sqlite" || name === "secret.key") return true;
  const parts = name.split("/");
  const [a = "", b = "", c = "", d = ""] = parts;
  if (parts.length === 4) return a === "partidas" && ID_RE.test(b) && c === "archivos" && FILE_NAME_RE.test(d);
  if (parts.length === 2) return a === "modulos" && PACKED_FILE_RE.test(b) && !b.startsWith(".");
  return false;
}

// --- tar (ustar) mínimo -------------------------------------------------------------------------

const BLOCK = 512;
const padOf = (size: number) => (BLOCK - (size % BLOCK)) % BLOCK;

function octal(n: number, len: number): string {
  return Math.floor(n).toString(8).padStart(len - 1, "0") + "\0";
}

function splitName(name: string): { name: string; prefix: string } {
  if (Buffer.byteLength(name) <= 100) return { name, prefix: "" };
  for (let i = name.indexOf("/"); i !== -1; i = name.indexOf("/", i + 1)) {
    const prefix = name.slice(0, i);
    const rest = name.slice(i + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(rest) <= 100) return { name: rest, prefix };
  }
  throw new BackupError(`Nombre demasiado largo para la copia: ${name}`);
}

export function tarHeader(fullName: string, size: number, mtimeMs: number): Buffer {
  const h = Buffer.alloc(BLOCK);
  const { name, prefix } = splitName(fullName);
  h.write(name, 0, 100, "utf8");
  h.write("0000644\0", 100, 8, "ascii");
  h.write("0000000\0", 108, 8, "ascii");
  h.write("0000000\0", 116, 8, "ascii");
  h.write(octal(size, 12), 124, 12, "ascii");
  h.write(octal(mtimeMs / 1000, 12), 136, 12, "ascii");
  h.fill(0x20, 148, 156); // la suma de control se calcula con este campo en blanco
  h.write("0", 156, 1, "ascii");
  h.write("ustar\0", 257, 6, "ascii");
  h.write("00", 263, 2, "ascii");
  h.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return h;
}

function readString(h: Buffer, start: number, len: number): string {
  const slice = h.subarray(start, start + len);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? len : end).toString("utf8");
}

function readOctal(h: Buffer, start: number, len: number): number {
  const s = readString(h, start, len).trim();
  if (!/^[0-7]*$/.test(s)) throw new BackupError("La copia está dañada (cabecera no válida)");
  return s ? parseInt(s, 8) : 0;
}

function checksumOk(h: Buffer): boolean {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h.readUInt8(i);
  return sum === readOctal(h, 148, 8);
}

// --- crear copia --------------------------------------------------------------------------------

interface Entry {
  name: string;
  path?: string;
  data?: Buffer;
}

async function listFiles(dataDir: string): Promise<Entry[]> {
  const out: Entry[] = [];
  const partidas = join(dataDir, "partidas");
  if (existsSync(partidas))
    for (const id of (await readdir(partidas, { withFileTypes: true })).filter((d) => d.isDirectory() && ID_RE.test(d.name)).map((d) => d.name).sort()) {
      const dir = join(partidas, id, "archivos");
      if (!existsSync(dir)) continue;
      for (const f of (await readdir(dir, { withFileTypes: true })).filter((d) => d.isFile() && FILE_NAME_RE.test(d.name)).map((d) => d.name).sort())
        out.push({ name: `partidas/${id}/archivos/${f}`, path: join(dir, f) });
    }
  const modulos = join(dataDir, "modulos");
  if (existsSync(modulos))
    for (const f of (await readdir(modulos, { withFileTypes: true })).filter((d) => d.isFile() && PACKED_FILE_RE.test(d.name) && !d.name.startsWith(".")).map((d) => d.name).sort())
      out.push({ name: `modulos/${f}`, path: join(modulos, f) });
  return out;
}

async function* tarStream(entries: Entry[], now: number, cleanup: () => Promise<void>): AsyncGenerator<Buffer> {
  try {
    for (const e of entries) {
      if (e.data) {
        yield tarHeader(e.name, e.data.length, now);
        yield e.data;
        yield Buffer.alloc(padOf(e.data.length));
        continue;
      }
      const st = await stat(e.path as string);
      yield tarHeader(e.name, st.size, st.mtimeMs);
      let n = 0;
      // Se lee exactamente el tamaño anunciado en la cabecera (si el archivo creció mientras tanto, no se rompe el tar).
      if (st.size > 0)
        for await (const chunk of createReadStream(e.path as string, { end: st.size - 1 })) {
          n += (chunk as Buffer).length;
          yield chunk as Buffer;
        }
      if (st.size > 0 && n !== st.size) throw new BackupError(`El archivo ${e.name} cambió mientras se copiaba`);
      yield Buffer.alloc(padOf(st.size));
    }
    yield Buffer.alloc(BLOCK * 2);
  } finally {
    await cleanup();
  }
}

/**
 * Crea la copia como un stream .tar.gz. La base de datos se copia con VACUUM INTO (una foto consistente aunque
 * haya gente jugando); el archivo temporal se borra al terminar o si la descarga se corta.
 */
export async function createBackup(db: Db, dataDir: string, now = Date.now()): Promise<Readable> {
  const tmp = join(dataDir, `.copia-${randomBytes(6).toString("hex")}.sqlite`);
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  const cleanup = () => rm(tmp, { force: true });
  try {
    const manifest = Buffer.from(JSON.stringify({ formato: BACKUP_FORMAT, app: "puercos-y-verrugas-vtt", creada: new Date(now).toISOString() }, null, 2));
    const secret = join(dataDir, "secret.key");
    const entries: Entry[] = [
      { name: MANIFEST, data: manifest },
      { name: "vtt.sqlite", path: tmp },
      ...(existsSync(secret) ? [{ name: "secret.key", path: secret }] : []),
      ...(await listFiles(dataDir)),
    ];
    const gz = createGzip();
    pipeline(Readable.from(tarStream(entries, now, cleanup)), gz).catch(() => undefined); // pipeline destruye gz si algo falla
    return gz;
  } catch (e) {
    await cleanup();
    throw e;
  }
}

export const backupFileName = (now = Date.now()) => `pyv-copia-${new Date(now).toISOString().slice(0, 16).replace(/[:T]/g, "-")}${BACKUP_EXT}`;

// --- leer copia ---------------------------------------------------------------------------------

/** Extrae una copia en `dest` (que se vacía antes), validando cada ruta. `maxBytes` limita el tamaño ya descomprimido. */
export async function extractBackup(input: Readable, dest: string, maxBytes: number): Promise<{ archivos: number; bytes: number }> {
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  const gunzip = createGunzip();
  input.on("error", (e) => gunzip.destroy(e));
  input.pipe(gunzip);

  let buf: Buffer = Buffer.alloc(0);
  let total = 0;
  let archivos = 0;
  let zeroBlocks = 0;
  let ended = false;
  let cur: { fh: FileHandle; remaining: number; pad: number } | null = null;
  const seen = new Set<string>();
  try {
    for await (const chunk of gunzip) {
      total += (chunk as Buffer).length;
      if (total > maxBytes) throw new BackupError(`La copia es demasiado grande (máximo ${Math.round(maxBytes / 1024 / 1024)} MB)`);
      if (ended) continue;
      buf = buf.length ? Buffer.concat([buf, chunk as Buffer]) : (chunk as Buffer);
      for (;;) {
        if (cur) {
          if (cur.remaining > 0) {
            if (!buf.length) break;
            const n = Math.min(cur.remaining, buf.length);
            await cur.fh.write(buf.subarray(0, n));
            cur.remaining -= n;
            buf = buf.subarray(n);
            continue;
          }
          if (buf.length < cur.pad) break;
          buf = buf.subarray(cur.pad);
          await cur.fh.close();
          cur = null;
          continue;
        }
        if (buf.length < BLOCK) break;
        const h = buf.subarray(0, BLOCK);
        buf = buf.subarray(BLOCK);
        if (h.every((b) => b === 0)) {
          if (++zeroBlocks >= 2) {
            ended = true;
            buf = Buffer.alloc(0);
            break;
          }
          continue;
        }
        zeroBlocks = 0;
        if (!checksumOk(h)) throw new BackupError("La copia está dañada (suma de control incorrecta)");
        const prefix = readString(h, 345, 155);
        // Se admite el "./" inicial que pone `tar -C carpeta .` (por si alguien rehace la copia a mano).
        const name = ((prefix ? `${prefix}/` : "") + readString(h, 0, 100)).replace(/^(\.\/)+/, "");
        const size = readOctal(h, 124, 12);
        const type = String.fromCharCode(h.readUInt8(156));
        if (type === "5") continue; // carpeta: se crean al escribir los archivos
        if (type !== "0" && type !== "\0") throw new BackupError(`La copia contiene un elemento no permitido: ${name}`);
        if (!isBackupPath(name)) throw new BackupError(`La copia contiene un archivo no permitido: ${name}`);
        if (seen.has(name)) throw new BackupError(`La copia contiene un archivo repetido: ${name}`);
        seen.add(name);
        const file = join(dest, ...name.split("/"));
        await mkdir(dirname(file), { recursive: true });
        cur = { fh: await open(file, "wx"), remaining: size, pad: padOf(size) };
        archivos++;
      }
    }
    if (cur || !ended) throw new BackupError("La copia está incompleta (¿se cortó la descarga o la subida?)");
  } catch (e) {
    await cur?.fh.close().catch(() => undefined);
    input.unpipe(gunzip);
    input.resume();
    if (e instanceof BackupError) throw e;
    throw new BackupError(`No se pudo leer la copia: ${(e as Error).message}`);
  }
  return { archivos, bytes: total };
}

async function validateExtracted(dir: string): Promise<void> {
  const manifestFile = join(dir, MANIFEST);
  if (!existsSync(manifestFile)) throw new BackupError("No es una copia de Puercos y Verrugas VTT (falta el manifiesto)");
  let formato: unknown;
  try {
    formato = (JSON.parse(await readFile(manifestFile, "utf8")) as { formato?: unknown }).formato;
  } catch {
    throw new BackupError("El manifiesto de la copia está dañado");
  }
  if (formato !== BACKUP_FORMAT) throw new BackupError(`Formato de copia no compatible (${String(formato)}); actualiza el VTT`);
  const dbFile = join(dir, "vtt.sqlite");
  if (!existsSync(dbFile)) throw new BackupError("La copia no contiene la base de datos");
  const fh = await open(dbFile, "r");
  try {
    const head = Buffer.alloc(16);
    await fh.read(head, 0, 16, 0);
    if (head.toString("latin1") !== "SQLite format 3\0") throw new BackupError("La base de datos de la copia está dañada");
  } finally {
    await fh.close();
  }
}

/** Prepara una restauración: extrae y valida la copia en <datos>/.restaurar. Se aplica al reiniciar. */
export async function stageRestore(input: Readable, dataDir: string, maxBytes: number): Promise<{ archivos: number; bytes: number }> {
  const dest = join(dataDir, PENDING_DIR);
  try {
    const r = await extractBackup(input, dest, maxBytes);
    await validateExtracted(dest);
    await writeFile(join(dest, READY), new Date().toISOString());
    return r;
  } catch (e) {
    await rm(dest, { recursive: true, force: true });
    throw e;
  }
}

export const restorePending = (dataDir: string) => existsSync(join(dataDir, PENDING_DIR, READY));

export async function cancelRestore(dataDir: string): Promise<void> {
  await rm(join(dataDir, PENDING_DIR), { recursive: true, force: true });
}

/**
 * Al arrancar, ANTES de abrir la base de datos: si hay una copia preparada (o un archivo restaurar.pyvbak),
 * mueve los datos actuales a .anterior y pone los de la copia en su lugar. Nunca impide arrancar: si la copia
 * no vale, se avisa por consola y se sigue con los datos actuales.
 */
export async function applyPendingRestore(dataDir: string, log: (msg: string) => void = console.log): Promise<boolean> {
  const dropped = join(dataDir, RESTORE_FILE);
  if (existsSync(dropped)) {
    try {
      await stageRestore(createReadStream(dropped), dataDir, Number.MAX_SAFE_INTEGER);
      await rm(dropped, { force: true });
    } catch (e) {
      log(`No se pudo restaurar ${RESTORE_FILE}: ${(e as Error).message}. Se renombra a ${RESTORE_FILE}.fallida y se siguen usando los datos actuales.`);
      await rename(dropped, `${dropped}.fallida`).catch(() => undefined);
    }
  }
  if (!restorePending(dataDir)) return false;

  const pending = join(dataDir, PENDING_DIR);
  const previous = join(dataDir, PREVIOUS_DIR);
  await rm(previous, { recursive: true, force: true });
  await mkdir(previous, { recursive: true });
  for (const item of DATA_ITEMS) if (existsSync(join(dataDir, item))) await rename(join(dataDir, item), join(previous, item));
  for (const item of await readdir(pending)) if (item !== READY && item !== MANIFEST) await rename(join(pending, item), join(dataDir, item));
  await rm(pending, { recursive: true, force: true });
  log(`Copia de datos restaurada. Los datos anteriores quedaron en ${previous}`);
  return true;
}

// --- espacio ------------------------------------------------------------------------------------

async function dirSize(path: string): Promise<number> {
  let total = 0;
  for (const d of await readdir(path, { withFileTypes: true }).catch(() => [])) {
    const p = join(path, d.name);
    if (d.isDirectory()) total += await dirSize(p);
    else if (d.isFile()) total += (await stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

export interface DataUsage {
  /** Lo que ocupa la carpeta de datos (incluye .anterior y .restaurar si existen). */
  bytes: number;
  /** De ello, lo que ocupan los datos de antes de la última restauración (se pueden borrar a mano). */
  anterior: number;
  /** Espacio libre y total del disco donde están los datos (null si el sistema no lo informa). */
  libre: number | null;
  total: number | null;
}

export async function dataUsage(dataDir: string): Promise<DataUsage> {
  const [bytes, anterior] = await Promise.all([dirSize(dataDir), dirSize(join(dataDir, PREVIOUS_DIR))]);
  let libre: number | null = null;
  let total: number | null = null;
  try {
    const s = await statfs(dataDir);
    libre = Number(s.bavail) * Number(s.bsize);
    total = Number(s.blocks) * Number(s.bsize);
  } catch {
    /* sin statfs */
  }
  return { bytes, anterior, libre, total };
}
