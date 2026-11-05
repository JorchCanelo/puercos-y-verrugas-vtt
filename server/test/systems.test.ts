// Ciclo 4: el núcleo no conoce reglas; todo pasa por el sistema de la Partida.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { GENERIC_SYSTEM_ID, createRegistry, defineSystem } from "@pyv/shared";
import { migrate, type Db } from "../src/db";
import { HttpError } from "../src/errors";
import * as svc from "../src/services";
import { buildSnapshot } from "../src/snapshot";
import { TEST_SYSTEM_ID, makeCtx, setup, testSheet, testSystem } from "./helpers";

/** Sistema que la migración 3 asigna a las Partidas creadas antes del ciclo 4. */
const LEGACY_ID = "pyv-clasico";

const rejects = (fn: () => unknown, status: number, match?: RegExp) => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof HttpError, `se esperaba HttpError y llegó ${String(e)}`);
    assert.equal(e.status, status, e.message);
    if (match) assert.match(e.message, match);
    return;
  }
  assert.fail(`se esperaba un error ${status}`);
};

test("migración 3: Partidas antiguas → sistema heredado, catálogo copiado y hojas intactas", () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  const db = raw as unknown as Db;
  migrate(db, 2); // base de datos como la del ciclo 3
  db.prepare("INSERT INTO partidas (id, nombre, activa, musica, creada_en) VALUES ('p1', 'Antigua', 1, '{}', 1)").run();
  db.prepare("INSERT INTO usuarios (id, partida_id, nombre, rol, es_anfitrion) VALUES ('u1', 'p1', 'N', 'narrador', 1)").run();
  const sheetJson = JSON.stringify({ nombre: "Vieja", stats: { a: 1 }, campoRaro: "se conserva" });
  db.prepare("INSERT INTO pjs (id, partida_id, sheet) VALUES ('pj1', 'p1', ?)").run(sheetJson);
  db.prepare("INSERT INTO hechizos (id, partida_id, nombre, descripcion, tipo, curso) VALUES ('h1', 'p1', 'Luz', 'Ilumina', 'Tipo A', 1)").run();
  db.prepare("INSERT INTO hechizos (id, partida_id, nombre, descripcion, tipo, curso) VALUES ('h2', 'p1', 'Atraer', '', 'Tipo A', 4)").run();

  migrate(db);
  assert.equal(Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version), 3);
  assert.equal(db.prepare("SELECT sistema FROM partidas WHERE id = 'p1'").get()?.sistema, LEGACY_ID);
  assert.equal(db.prepare("SELECT sheet FROM pjs WHERE id = 'pj1'").get()?.sheet, sheetJson, "el JSON de la hoja no se toca");
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM hechizos").get()?.n), 2, "la tabla antigua se conserva");
  const rows = db.prepare("SELECT clave, data FROM catalogo ORDER BY clave").all();
  assert.deepEqual(rows.map((r) => r.clave), ["atraer|4", "luz|1"]);
  assert.deepEqual(JSON.parse(String(rows[1]?.data)), { nombre: "Luz", descripcion: "Ilumina", tipo: "Tipo A", curso: 1 });

  // Sin el módulo instalado: la Partida abre en solo lectura y muestra lo que hay.
  const { ctx } = makeCtx(createRegistry([]));
  const bare = { ...ctx, db };
  const host = { id: "u1", rol: "narrador" as const, partidaId: "p1", nombre: "N" };
  const snap = buildSnapshot(bare, host);
  assert.equal(snap.partida.sistemaDisponible, false);
  assert.equal(snap.pjs[0]?.nombre, "Vieja");
  assert.equal(snap.catalogo.length, 2);

  // Con un sistema instalado con ese id, vuelve a estar disponible.
  const legacy = defineSystem({ ...testSystem, id: LEGACY_ID, sheet: { ...testSystem.sheet, displayName: (s) => s.nombre } });
  assert.equal(buildSnapshot({ ...bare, systems: createRegistry([legacy]) }, host).partida.sistemaDisponible, true);
});

test("Partida nueva: sistema genérico por defecto; sistemas desconocidos se rechazan", async () => {
  const { ctx } = makeCtx();
  const p = svc.createPartida(ctx, { nombre: "Nueva", descripcion: "", anfitrionNombre: "N" });
  assert.equal(p.sistema, GENERIC_SYSTEM_ID);
  assert.equal(p.sistemaDisponible, true);
  rejects(() => svc.createPartida(ctx, { nombre: "X", descripcion: "", anfitrionNombre: "N", sistema: "no-existe" }), 422, /no está instalado/);
  assert.deepEqual(svc.listSistemas(ctx).map((s) => s.id), [GENERIC_SYSTEM_ID, TEST_SYSTEM_ID], "el genérico primero");
});

test("cambiar el sistema: solo sin PJs y solo a uno instalado", async () => {
  const { ctx } = makeCtx();
  const { partida, ana } = await setup(ctx, GENERIC_SYSTEM_ID);
  assert.equal(svc.patchPartida(ctx, partida.id, { sistema: TEST_SYSTEM_ID }).sistema, TEST_SYSTEM_ID);
  rejects(() => svc.patchPartida(ctx, partida.id, { sistema: "no-existe" }), 422);
  svc.patchPartida(ctx, partida.id, { sistema: GENERIC_SYSTEM_ID });
  svc.createPj(ctx, ana, { sheet: { nombre: "Lía" } });
  rejects(() => svc.patchPartida(ctx, partida.id, { sistema: TEST_SYSTEM_ID }), 409, /personajes/);
  assert.equal(svc.patchPartida(ctx, partida.id, { sistema: GENERIC_SYSTEM_ID }).sistema, GENERIC_SYSTEM_ID, "mismo sistema: sin error");
});

test("hoja genérica: nombre, notas y campos de texto; sin movimientos, progreso ni catálogo", async () => {
  const { ctx } = makeCtx();
  const { narrador, ana, beto } = await setup(ctx, GENERIC_SYSTEM_ID);
  const pj = svc.createPj(ctx, ana, { sheet: { nombre: "Lía", campos: [{ id: "c1", nombre: "Fuerza", valor: "3" }] } });
  assert.equal(pj.nombre, "Lía");
  assert.deepEqual(pj.sheet, { nombre: "Lía", notas: "", campos: [{ id: "c1", nombre: "Fuerza", valor: "3" }] });
  rejects(() => svc.createPj(ctx, ana, { sheet: { nombre: "" } }), 422);
  rejects(() => svc.createPj(ctx, ana, { sheet: { nombre: "X", campos: [{ id: "c", nombre: "N", valor: 3 }] } }), 422);

  // Sin edición libre: notas y campos sí; nombre e imagen no.
  const upd = svc.patchPj(ctx, ana, pj.id, { sheet: { notas: "Valiente", campos: [] } });
  assert.deepEqual(upd.sheet, { nombre: "Lía", notas: "Valiente", campos: [] });
  rejects(() => svc.patchPj(ctx, ana, pj.id, { sheet: { nombre: "Otra" } }), 403, /nombre/);
  rejects(() => svc.patchPj(ctx, beto, pj.id, { sheet: { notas: "x" } }), 404);
  assert.equal(svc.patchPj(ctx, narrador, pj.id, { sheet: { nombre: "Lía Luna" } }).nombre, "Lía Luna");

  rejects(() => svc.rollMovement(ctx, ana, { pjId: pj.id, movimientoId: "x", privada: false }), 422, /dados libres/);
  rejects(() => svc.progressPj(ctx, ana, pj.id, {}), 422, /progreso/);
  rejects(() => svc.addCatalogEntry(ctx, ana, { nombre: "x" }), 422, /catálogo/);
  assert.equal(svc.rollFree(ctx, ana, { cantidad: 2, caras: 6, modificador: 0, privada: false }).dados.length, 2);

  // El nombre del PJ aparece en fichas y en el chat.
  const escena = svc.createEscena(ctx, narrador, { nombre: "E", tipo: "imagen", filas: 10, columnas: 10, abierta: true });
  assert.equal(svc.createFicha(ctx, narrador, escena.id, { ref: { tipo: "pj", id: pj.id }, x: 0.5, y: 0.5, oculta: false }).nombre, "Lía Luna");
  assert.equal(svc.sendMessage(ctx, ana, { texto: "hola", pjId: pj.id }).remitenteNombre, "Lía Luna");
});

test("sistema no instalado: la Partida abre en solo lectura y no se toca el JSON", async () => {
  const { ctx } = makeCtx();
  const { narrador, ana } = await setup(ctx);
  const pj = svc.createPj(ctx, ana, { sheet: testSheet({ trucos: ["Salto"] }) });
  const before = ctx.db.prepare("SELECT sheet FROM pjs WHERE id = ?").get(pj.id)?.sheet;

  const bare = { ...ctx, systems: createRegistry([]) }; // el VTT base, sin el sistema
  const snap = buildSnapshot(bare, narrador);
  assert.equal(snap.partida.sistema, TEST_SYSTEM_ID);
  assert.equal(snap.partida.sistemaDisponible, false);
  assert.equal(snap.partida.sistemaNombre, TEST_SYSTEM_ID);
  assert.equal(snap.pjs[0]?.nombre, "Lía", "sin el sistema, el campo nombre de la hoja");
  assert.deepEqual(snap.pjs[0]?.sheet, JSON.parse(String(before)));
  assert.equal(buildSnapshot(bare, ana).pjs.length, 1);

  rejects(() => svc.patchPj(bare, ana, pj.id, { sheet: { puntos: 1 } }), 409, /solo lectura/);
  rejects(() => svc.patchPj(bare, narrador, pj.id, { imagen: null }), 409);
  rejects(() => svc.createPj(bare, ana, { sheet: testSheet() }), 409);
  rejects(() => svc.progressPj(bare, ana, pj.id, { truco: "x" }), 409);
  rejects(() => svc.rollMovement(bare, ana, { pjId: pj.id, movimientoId: "golpe", privada: false }), 409);
  rejects(() => svc.addCatalogEntry(bare, ana, { truco: "x" }), 409);
  rejects(() => svc.deletePj(bare, narrador, pj.id), 409);
  assert.equal(ctx.db.prepare("SELECT sheet FROM pjs WHERE id = ?").get(pj.id)?.sheet, before);

  // Lo demás funciona: chat (como el PJ), dados libres.
  assert.equal(svc.sendMessage(bare, ana, { texto: "hola", pjId: pj.id }).remitenteNombre, "Lía");
  assert.ok(svc.rollFree(bare, ana, { cantidad: 1, caras: 20, modificador: 0, privada: false }));
  assert.equal(svc.listPartidas(bare)[0]?.sistemaDisponible, false);
});

test("el catálogo es de cada sistema: al cambiar de sistema no se mezcla", async () => {
  const otro = defineSystem({ ...testSystem, id: "otro" });
  const { ctx } = makeCtx(createRegistry([testSystem, otro]));
  const { partida, narrador } = await setup(ctx);
  svc.addCatalogEntry(ctx, narrador, { truco: "Salto" });
  svc.addCatalogEntry(ctx, narrador, { truco: "SALTO" }); // misma clave en el sistema de prueba
  assert.equal(buildSnapshot(ctx, narrador).catalogo.length, 1);
  svc.patchPartida(ctx, partida.id, { sistema: "otro" });
  assert.equal(buildSnapshot(ctx, narrador).catalogo.length, 0);
  svc.patchPartida(ctx, partida.id, { sistema: TEST_SYSTEM_ID });
  assert.equal(buildSnapshot(ctx, narrador).catalogo.length, 1);
});
