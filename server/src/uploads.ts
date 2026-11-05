import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { HttpError } from "./errors";

export type FileKind = "imagen" | "pdf" | "audio";

/** Detecta el tipo real por los primeros bytes: nunca se confía en el mimetype ni en la extensión del cliente. */
export function sniff(head: Buffer): { ext: string; kind: FileKind } | null {
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  const ascii = (s: string, at = 0) => head.subarray(at, at + s.length).toString("latin1") === s;
  if (starts(0x89, 0x50, 0x4e, 0x47)) return { ext: "png", kind: "imagen" };
  if (starts(0xff, 0xd8, 0xff)) return { ext: "jpg", kind: "imagen" };
  if (ascii("GIF8")) return { ext: "gif", kind: "imagen" };
  if (ascii("RIFF") && ascii("WEBP", 8)) return { ext: "webp", kind: "imagen" };
  if (ascii("%PDF-")) return { ext: "pdf", kind: "pdf" };
  if (ascii("OggS")) return { ext: "ogg", kind: "audio" };
  if (ascii("RIFF") && ascii("WAVE", 8)) return { ext: "wav", kind: "audio" };
  if (ascii("fLaC")) return { ext: "flac", kind: "audio" };
  if (ascii("ID3") || (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0)) return { ext: "mp3", kind: "audio" };
  if (ascii("ftyp", 4)) return { ext: "m4a", kind: "audio" };
  return null;
}

export const FILE_NAME_RE = /^[A-Za-z0-9_-]+\.[a-z0-9]{2,5}$/;
const MB = 1024 * 1024;

export interface UploadOptions {
  dataDir: string;
  partidaId: string;
  allowed: readonly FileKind[];
  /** Tope por tipo en bytes. */
  maxBytes: Partial<Record<FileKind, number>>;
}

export const partidaFilesDir = (dataDir: string, partidaId: string) => join(dataDir, "partidas", partidaId, "archivos");

export const LIMITS_NARRATOR: UploadOptions["maxBytes"] = { imagen: 20 * MB, pdf: 50 * MB, audio: 100 * MB };
export const LIMITS_PLAYER: UploadOptions["maxBytes"] = { imagen: 10 * MB, pdf: 20 * MB };

/** Guarda un archivo subido (stream) validando tipo real y tamaño. Devuelve el nombre generado. */
export async function saveUpload(file: Readable & { truncated?: boolean }, opts: UploadOptions): Promise<{ archivo: string; kind: FileKind }> {
  const dir = partidaFilesDir(opts.dataDir, opts.partidaId);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `${randomUUID()}.part`);
  try {
    await pipeline(file, createWriteStream(tmp));
    if (file.truncated) throw new HttpError(413, "Archivo demasiado grande");
    const fh = await open(tmp, "r");
    const head = Buffer.alloc(16);
    try {
      await fh.read(head, 0, 16, 0);
    } finally {
      await fh.close();
    }
    const found = sniff(head);
    if (!found || !opts.allowed.includes(found.kind)) throw new HttpError(415, "Tipo de archivo no permitido");
    const size = (await stat(tmp)).size;
    const max = opts.maxBytes[found.kind] ?? 0;
    if (size > max) throw new HttpError(413, `El archivo supera el máximo de ${Math.round(max / MB)} MB`);
    const archivo = `${randomUUID()}.${found.ext}`;
    await rename(tmp, join(dir, archivo));
    return { archivo, kind: found.kind };
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}
