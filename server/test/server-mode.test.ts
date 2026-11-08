// Ciclo 8: modo servidor (configuración, sesión del panel con contraseña) y copia/restauración de datos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { gzipSync } from "node:zlib";
import { checkAdminPassword, signAdmin, verifyAdmin, ADMIN_TTL_MS } from "../src/adminAuth";
import { BackupError, MANIFEST, PENDING_DIR, PREVIOUS_DIR, RESTORE_FILE, applyPendingRestore, cancelRestore, createBackup, dataUsage, extractBackup, isBackupPath, restorePending, stageRestore, tarHeader } from "../src/backup";
import { parseTrustProxy, readServerConfig } from "../src/config";
import { openDb } from "../src/db";

const tmp = () => mkdtempSync(join(tmpdir(), "pyv-c8-"));
const quiet = () => undefined;

test("config: sin variables todo queda como en local", () => {
  const c = readServerConfig({});
  assert.equal(c.adminPassword, null);
  assert.equal(c.publicUrl, null);
  assert.equal(c.trustProxy, "loopback");
  assert.ok(c.restoreMaxBytes > 1024 * 1024 * 1024);
});

test("config: modo servidor, URL normalizada y errores claros", () => {
  const c = readServerConfig({ VTT_ADMIN_PASSWORD: "una-clave-larga", VTT_PUBLIC_URL: "https://mesapyv.ejemplo.xyz/algo/", VTT_RESTORE_MAX_MB: "10" });
  assert.equal(c.adminPassword, "una-clave-larga");
  assert.equal(c.publicUrl, "https://mesapyv.ejemplo.xyz");
  assert.equal(c.restoreMaxBytes, 10 * 1024 * 1024);
  assert.throws(() => readServerConfig({ VTT_ADMIN_PASSWORD: "corta" }), /al menos 8/);
  assert.throws(() => readServerConfig({ VTT_PUBLIC_URL: "no es url" }), /URL válida/);
  assert.throws(() => readServerConfig({ VTT_PUBLIC_URL: "ftp://x.y" }), /https/);
  assert.equal(readServerConfig({ VTT_ADMIN_PASSWORD: "" }).adminPassword, null);
});

test("config: VTT_TRUST_PROXY", () => {
  assert.equal(parseTrustProxy(undefined), "loopback");
  assert.equal(parseTrustProxy("true"), true);
  assert.equal(parseTrustProxy("1"), true);
  assert.equal(parseTrustProxy("false"), false);
  assert.equal(parseTrustProxy("2"), 2);
  assert.equal(parseTrustProxy("10.0.0.0/8"), "10.0.0.0/8");
  assert.deepEqual(parseTrustProxy("loopback, 172.16.0.0/12"), ["loopback", "172.16.0.0/12"]);
});

test("panel: contraseña y cookie firmada (caduca y se invalida al cambiar la contraseña)", () => {
  const secret = Buffer.alloc(32, 7);
  assert.equal(checkAdminPassword("clave-correcta", "clave-correcta"), true);
  assert.equal(checkAdminPassword("clave-incorrecta", "clave-correcta"), false);
  assert.equal(checkAdminPassword("", "clave-correcta"), false);

  const now = 1_000_000;
  const tok = signAdmin(secret, "clave-1234", now);
  assert.equal(verifyAdmin(secret, "clave-1234", tok, now + 1000), true);
  assert.equal(verifyAdmin(secret, "clave-1234", tok, now + ADMIN_TTL_MS + 1), false, "caducada");
  assert.equal(verifyAdmin(secret, "otra-clave", tok, now + 1000), false, "cambió la contraseña");
  assert.equal(verifyAdmin(Buffer.alloc(32, 8), "clave-1234", tok, now + 1000), false, "otro secreto");
  assert.equal(verifyAdmin(secret, "clave-1234", `${tok}x`, now + 1000), false, "firma alterada");
  assert.equal(verifyAdmin(secret, "clave-1234", undefined, now), false);
  assert.equal(verifyAdmin(secret, "clave-1234", "basura", now), false);
});

test("copia: rutas permitidas", () => {
  assert.ok(isBackupPath(MANIFEST));
  assert.ok(isBackupPath("vtt.sqlite"));
  assert.ok(isBackupPath("secret.key"));
  assert.ok(isBackupPath("partidas/7f394c97-13bc-4c61-a71b-fcffbb7791e1/archivos/aeae1c0b-e878-411e-ac40-461356d53563.m4a"));
  assert.ok(isBackupPath("modulos/pyv-clasico.pyvmod"));
  for (const bad of ["../vtt.sqlite", "/etc/passwd", "partidas/../../x/archivos/a.png", "partidas/a/archivos/../b.png", "otra.txt", "modulos/x.js", "modulos/.oculto.pyvmod", "partidas/a/otra/b.png"])
    assert.equal(isBackupPath(bad), false, bad);
});

/** Crea una carpeta de datos con base de datos, secreto, archivos y un módulo. */
function seedData(dir: string) {
  const db = openDb(join(dir, "vtt.sqlite"));
  db.prepare("INSERT INTO partidas (id, nombre, musica, creada_en) VALUES (?, ?, ?, ?)").run("p-1", "Las Sombras", "{}", 1);
  writeFileSync(join(dir, "secret.key"), "secreto-de-prueba");
  const files = join(dir, "partidas", "p-1", "archivos");
  mkdirSync(files, { recursive: true });
  writeFileSync(join(files, "abc-123.png"), Buffer.alloc(70_000, 1)); // no múltiplo de 512
  writeFileSync(join(files, "vacio.mp3"), Buffer.alloc(0));
  writeFileSync(join(files, ".tmp-subida"), "temporal: no va en la copia");
  mkdirSync(join(dir, "modulos"));
  writeFileSync(join(dir, "modulos", "pyv-clasico.pyvmod"), Buffer.from("modulo"));
  return db;
}

test("copia: descargar y restaurar conserva base de datos, secreto, archivos y módulos", async () => {
  const origen = tmp();
  const destino = tmp();
  try {
    const db = seedData(origen);
    const gz = await buffer(await createBackup(db, origen, Date.UTC(2026, 10, 8)));
    db.close();
    assert.equal(existsSync(join(origen, "partidas")), true);
    assert.equal(
      (await import("node:fs")).readdirSync(origen).some((f) => f.startsWith(".copia-")),
      false,
      "el temporal de VACUUM INTO se borra",
    );

    // El destino ya tiene una mesa distinta: debe quedar en .anterior.
    const dbDest = openDb(join(destino, "vtt.sqlite"));
    dbDest.prepare("INSERT INTO partidas (id, nombre, musica, creada_en) VALUES (?, ?, ?, ?)").run("p-vieja", "Vieja", "{}", 1);
    dbDest.close();
    writeFileSync(join(destino, "secret.key"), "secreto-viejo");

    const r = await stageRestore(Readable.from([gz]), destino, 100 * 1024 * 1024);
    assert.equal(r.archivos, 6); // manifiesto, base, secreto, 2 archivos, módulo
    assert.equal(restorePending(destino), true);
    assert.equal(readFileSync(join(destino, "secret.key"), "utf8"), "secreto-viejo", "no se toca la mesa en uso");

    assert.equal(await applyPendingRestore(destino, quiet), true);
    assert.equal(restorePending(destino), false);
    assert.equal(existsSync(join(destino, PENDING_DIR)), false);
    assert.equal(readFileSync(join(destino, "secret.key"), "utf8"), "secreto-de-prueba");
    assert.equal(readFileSync(join(destino, PREVIOUS_DIR, "secret.key"), "utf8"), "secreto-viejo");
    assert.deepEqual(readFileSync(join(destino, "partidas", "p-1", "archivos", "abc-123.png")), Buffer.alloc(70_000, 1));
    assert.equal(readFileSync(join(destino, "partidas", "p-1", "archivos", "vacio.mp3")).length, 0);
    assert.equal(existsSync(join(destino, "partidas", "p-1", "archivos", ".tmp-subida")), false);
    assert.equal(readFileSync(join(destino, "modulos", "pyv-clasico.pyvmod"), "utf8"), "modulo");
    assert.equal(existsSync(join(destino, MANIFEST)), false);

    const restored = openDb(join(destino, "vtt.sqlite"));
    assert.deepEqual(
      restored.prepare("SELECT id, nombre FROM partidas").all().map((x) => ({ ...x })),
      [{ id: "p-1", nombre: "Las Sombras" }],
    );
    restored.close();

    const uso = await dataUsage(destino);
    assert.ok(uso.bytes > 70_000);
    assert.ok(uso.anterior > 0);
  } finally {
    rmSync(origen, { recursive: true, force: true });
    rmSync(destino, { recursive: true, force: true });
  }
});

/** Construye un .tar.gz a mano con las entradas dadas. */
function tarGz(entries: { name: string; data: Buffer }[], end = true): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    parts.push(tarHeader(e.name, e.data.length, 0), e.data, Buffer.alloc((512 - (e.data.length % 512)) % 512));
  }
  if (end) parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

const manifest = Buffer.from(JSON.stringify({ formato: 1 }));
const fakeDb = Buffer.concat([Buffer.from("SQLite format 3\0", "latin1"), Buffer.alloc(100)]);

test("copia: rechaza rutas peligrosas, copias incompletas, ajenas o demasiado grandes", async () => {
  const dir = tmp();
  try {
    const stage = (b: Buffer, max = 10 * 1024 * 1024) => stageRestore(Readable.from([b]), dir, max);
    await assert.rejects(stage(tarGz([{ name: "../fuera.txt", data: Buffer.from("x") }])), /no permitido/);
    assert.equal(existsSync(join(dir, "..", "fuera.txt")), false);
    await assert.rejects(stage(tarGz([{ name: MANIFEST, data: manifest }, { name: "vtt.sqlite", data: fakeDb }], false)), /incompleta/);
    await assert.rejects(stage(tarGz([{ name: "vtt.sqlite", data: fakeDb }])), /manifiesto/);
    await assert.rejects(stage(tarGz([{ name: MANIFEST, data: Buffer.from('{"formato":2}') }, { name: "vtt.sqlite", data: fakeDb }])), /no compatible/);
    await assert.rejects(stage(tarGz([{ name: MANIFEST, data: manifest }, { name: "vtt.sqlite", data: Buffer.from("no soy sqlite") }])), /dañada/);
    await assert.rejects(stage(tarGz([{ name: MANIFEST, data: manifest }, { name: "vtt.sqlite", data: Buffer.alloc(4096) }]), 1024), /demasiado grande/);
    await assert.rejects(stage(Buffer.from("esto no es gzip")), BackupError);
    // Repetidos.
    await assert.rejects(stage(tarGz([{ name: MANIFEST, data: manifest }, { name: MANIFEST, data: manifest }])), /repetido/);
    assert.equal(restorePending(dir), false, "nada queda preparado tras un error");
    assert.equal(existsSync(join(dir, PENDING_DIR)), false);

    // Una copia mínima válida sí se acepta, y se puede descartar.
    await stage(tarGz([{ name: MANIFEST, data: manifest }, { name: "vtt.sqlite", data: fakeDb }]));
    assert.equal(restorePending(dir), true);
    await cancelRestore(dir);
    assert.equal(restorePending(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("copia: nombres largos usan el prefijo ustar", async () => {
  const dir = tmp();
  try {
    const id = "a".repeat(64);
    const name = `partidas/${id}/archivos/${"b".repeat(40)}.png`;
    assert.ok(name.length > 100);
    await extractBackup(Readable.from([tarGz([{ name, data: Buffer.from("png") }])]), dir, 1e6);
    assert.equal(readFileSync(join(dir, "partidas", id, "archivos", `${"b".repeat(40)}.png`), "utf8"), "png");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("copia: restaurar.pyvbak dejado en la carpeta se aplica al arrancar; si está dañado no impide arrancar", async () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, RESTORE_FILE), tarGz([{ name: MANIFEST, data: manifest }, { name: "vtt.sqlite", data: fakeDb }, { name: "secret.key", data: Buffer.from("nuevo") }]));
    writeFileSync(join(dir, "secret.key"), "viejo");
    assert.equal(await applyPendingRestore(dir, quiet), true);
    assert.equal(readFileSync(join(dir, "secret.key"), "utf8"), "nuevo");
    assert.equal(existsSync(join(dir, RESTORE_FILE)), false);

    writeFileSync(join(dir, RESTORE_FILE), "dañado");
    const logs: string[] = [];
    assert.equal(await applyPendingRestore(dir, (m) => logs.push(m)), false);
    assert.equal(readFileSync(join(dir, "secret.key"), "utf8"), "nuevo");
    assert.equal(existsSync(join(dir, `${RESTORE_FILE}.fallida`)), true);
    assert.match(logs.join("\n"), /No se pudo restaurar/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
