import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { HostTokens, LoginLimiter, hashPassword, loadSecret, signSession, verifyPassword, verifySession } from "../src/auth";
import { HttpError } from "../src/errors";
import { FILE_NAME_RE, LIMITS_PLAYER, partidaFilesDir, saveUpload, sniff } from "../src/uploads";

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64)]);
const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64)]);
const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64)]);
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

test("sniff detecta el tipo real por los primeros bytes", () => {
  assert.deepEqual(sniff(png), { ext: "png", kind: "imagen" });
  assert.deepEqual(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), { ext: "jpg", kind: "imagen" });
  assert.deepEqual(sniff(Buffer.concat([Buffer.from("RIFF\0\0\0\0WEBP")])), { ext: "webp", kind: "imagen" });
  assert.deepEqual(sniff(Buffer.concat([Buffer.from("RIFF\0\0\0\0WAVE")])), { ext: "wav", kind: "audio" });
  assert.deepEqual(sniff(pdf), { ext: "pdf", kind: "pdf" });
  assert.deepEqual(sniff(mp3), { ext: "mp3", kind: "audio" });
  assert.deepEqual(sniff(Buffer.from([0xff, 0xfb, 0x90, 0x00])), { ext: "mp3", kind: "audio" });
  assert.deepEqual(sniff(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypM4A ")])), { ext: "m4a", kind: "audio" });
  assert.equal(sniff(exe), null);
  assert.equal(sniff(svg), null); // SVG se rechaza a propósito (puede llevar scripts)
});

test("saveUpload: guarda con nombre UUID, rechaza tipos no permitidos y limpia temporales", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vtt-up-"));
  try {
    const opts = { dataDir: dir, partidaId: "p1", allowed: ["imagen", "pdf"] as const, maxBytes: LIMITS_PLAYER };
    const ok = await saveUpload(Readable.from([png]), opts);
    assert.equal(ok.kind, "imagen");
    assert.match(ok.archivo, FILE_NAME_RE);
    assert.ok(existsSync(join(partidaFilesDir(dir, "p1"), ok.archivo)));

    // un jugador no puede subir audio ni ejecutables ni SVG, aunque lo disfracen de .png
    for (const bad of [mp3, exe, svg]) {
      await assert.rejects(saveUpload(Readable.from([bad]), opts), (e: unknown) => e instanceof HttpError && e.status === 415);
    }
    // y no quedan archivos temporales
    assert.deepEqual(readdirSync(partidaFilesDir(dir, "p1")).filter((f) => f.endsWith(".part")), []);
    assert.equal(readdirSync(partidaFilesDir(dir, "p1")).length, 1);

    // límite de tamaño por tipo
    const big = Buffer.concat([png, Buffer.alloc(11 * 1024 * 1024)]);
    await assert.rejects(saveUpload(Readable.from([big]), opts), (e: unknown) => e instanceof HttpError && e.status === 413);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("contraseñas: hash con sal, verificación y rechazo", async () => {
  const h = await hashPassword("abracadabra");
  assert.match(h, /^scrypt\$/);
  assert.notEqual(h, await hashPassword("abracadabra")); // sal distinta
  assert.equal(await verifyPassword("abracadabra", h), true);
  assert.equal(await verifyPassword("alohomora", h), false);
  assert.equal(await verifyPassword("lo-que-sea", null), false); // sin hash (Narrador anfitrión) nunca entra
  assert.equal(await verifyPassword("x", "basura"), false);
});

test("sesiones: firma, caducidad y manipulación", () => {
  const secret = Buffer.alloc(32, 1);
  const t = signSession(secret, { u: "u1", p: "p1", e: 2000 });
  assert.deepEqual(verifySession(secret, t, 1000), { u: "u1", p: "p1", e: 2000 });
  assert.equal(verifySession(secret, t, 2000), null); // caducada
  assert.equal(verifySession(Buffer.alloc(32, 2), t, 1000), null);
  assert.equal(verifySession(secret, "a.b", 1000), null);
  assert.equal(verifySession(secret, "", 1000), null);
});

test("el secreto se crea una vez y se reutiliza", () => {
  const dir = mkdtempSync(join(tmpdir(), "vtt-secret-"));
  try {
    const a = loadSecret(dir);
    assert.equal(a.length, 32);
    assert.deepEqual(loadSecret(dir), a);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("HostTokens y LoginLimiter", () => {
  let now = 0;
  const tokens = new HostTokens(() => now);
  const t = tokens.mint("p1");
  assert.equal(tokens.consume(t), "p1");
  assert.equal(tokens.consume(t), null);

  const lim = new LoginLimiter(3, 1000, () => now);
  assert.deepEqual([1, 2, 3, 4].map(() => lim.attempt("k")), [true, true, true, false]);
  assert.equal(lim.attempt("otro"), true);
  now = 1500;
  assert.equal(lim.attempt("k"), true); // la ventana expiró
});
