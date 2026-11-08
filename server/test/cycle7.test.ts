// Ciclo 7: permisos de jugadores sobre NPCs, ocultar por ficha, quitar fichas propias y niveles de materiales.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrate, type Db } from "../src/db";
import { HttpError } from "../src/errors";
import * as svc from "../src/services";
import { buildSnapshot } from "../src/snapshot";
import { makeCtx, setup, testSheet } from "./helpers";

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

test("NPCs: Ninguno no los recibe, Observador los ve, Propietario edita y borra; permisos y carpeta solo el Narrador", async () => {
  const { ctx } = makeCtx();
  const { narrador, ana, beto, segunda } = await setup(ctx);
  const lechuza = svc.createNpc(ctx, narrador, {
    nombre: "Lechuza",
    notas: "mensajera",
    carpeta: "Mascotas",
    acceso: [
      { usuarioId: ana.id, nivel: "propietario" },
      { usuarioId: beto.id, nivel: "observador" },
    ],
  });
  const secreto = svc.createNpc(ctx, narrador, { nombre: "Villano", notas: "es el director", carpeta: "", acceso: [] });

  const npcsOf = (a: typeof ana) => buildSnapshot(ctx, a).npcs;
  assert.deepEqual(npcsOf(ana).map((n) => [n.nombre, n.notas]), [["Lechuza", "mensajera"]]);
  assert.deepEqual(npcsOf(ana)[0]?.acceso, [{ usuarioId: ana.id, nivel: "propietario" }], "solo su propia entrada");
  assert.deepEqual(npcsOf(beto).map((n) => n.nombre), ["Lechuza"]);
  assert.equal(npcsOf(narrador).length, 2);
  assert.equal(npcsOf(segunda).length, 2); // otro Narrador también

  rejects(() => svc.patchNpc(ctx, beto, lechuza.id, { notas: "x" }), 403); // observador
  rejects(() => svc.patchNpc(ctx, beto, secreto.id, { notas: "x" }), 404); // ni sabe que existe
  assert.equal(svc.patchNpc(ctx, ana, lechuza.id, { nombre: "Hedwig", notas: "blanca" }).nombre, "Hedwig");
  rejects(() => svc.patchNpc(ctx, ana, lechuza.id, { carpeta: "Mías" }), 403);
  rejects(() => svc.patchNpc(ctx, ana, lechuza.id, { acceso: [] }), 403);
  rejects(() => svc.createNpc(ctx, ana, { nombre: "Mío", notas: "", carpeta: "", acceso: [] }), 403);
  rejects(() => svc.patchNpc(ctx, narrador, lechuza.id, { acceso: [{ usuarioId: "fantasma", nivel: "observador" }] }), 422);

  rejects(() => svc.deleteNpc(ctx, beto, lechuza.id), 403);
  svc.deleteNpc(ctx, ana, lechuza.id);
  assert.equal(npcsOf(narrador).length, 1);
});

test("fichas: el propietario de un NPC la pone, mueve y quita como la de su PJ; ocultar es solo del Narrador", async () => {
  const { ctx } = makeCtx();
  const { narrador, ana, beto } = await setup(ctx);
  const pj = svc.createPj(ctx, ana, { sheet: testSheet() });
  const gato = svc.createNpc(ctx, narrador, { nombre: "Gato", notas: "", carpeta: "", acceso: [{ usuarioId: ana.id, nivel: "propietario" }, { usuarioId: beto.id, nivel: "observador" }] });
  const e = svc.createEscena(ctx, narrador, { nombre: "Patio", tipo: "imagen", filas: 1, columnas: 1, abierta: true });
  svc.proyectarEscena(ctx, narrador, e.id);

  rejects(() => svc.createFicha(ctx, beto, e.id, { ref: { tipo: "npc", id: gato.id }, x: 0.5, y: 0.5, oculta: false }), 403); // observador
  const fg = svc.createFicha(ctx, ana, e.id, { ref: { tipo: "npc", id: gato.id }, x: 0.5, y: 0.5, oculta: false });
  assert.equal(svc.moveFicha(ctx, ana, fg.id, { x: 0.2, y: 0.3 }).x, 0.2);
  rejects(() => svc.moveFicha(ctx, beto, fg.id, { x: 0.1 }), 403);
  rejects(() => svc.moveFicha(ctx, ana, fg.id, { oculta: true }), 403);
  rejects(() => svc.deleteFicha(ctx, beto, fg.id), 403);
  svc.deleteFicha(ctx, ana, fg.id);

  // su PJ: también la quita; si el Narrador la oculta, ya no la toca
  const fp = svc.createFicha(ctx, ana, e.id, { ref: { tipo: "pj", id: pj.id }, x: 0.5, y: 0.5, oculta: false });
  svc.moveFicha(ctx, narrador, fp.id, { oculta: true });
  assert.equal(buildSnapshot(ctx, ana).fichas.length, 0);
  rejects(() => svc.deleteFicha(ctx, ana, fp.id), 403);
  svc.moveFicha(ctx, narrador, fp.id, { oculta: false });
  svc.deleteFicha(ctx, ana, fp.id);
  assert.equal(buildSnapshot(ctx, narrador).fichas.length, 0);
});

test("migración 5: las fichas de NPCs ocultos quedan ocultas y los niveles de materiales se renombran", () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  const db = raw as unknown as Db;
  migrate(db, 4);
  db.prepare("INSERT INTO partidas (id, nombre, activa, musica, creada_en) VALUES ('p1', 'P', 1, '{}', 1)").run();
  db.prepare("INSERT INTO npcs (id, partida_id, nombre, oculto) VALUES ('n1', 'p1', 'Oculto', 1), ('n2', 'p1', 'Visible', 0)").run();
  db.prepare("INSERT INTO escenas (id, partida_id, nombre, tipo) VALUES ('e1', 'p1', 'E', 'imagen')").run();
  db.prepare(
    "INSERT INTO fichas (id, escena_id, partida_id, ref_tipo, ref_id, x, y, oculta) VALUES ('f1', 'e1', 'p1', 'npc', 'n1', 0, 0, 0), ('f2', 'e1', 'p1', 'npc', 'n2', 0, 0, 0)",
  ).run();
  db.prepare(
    `INSERT INTO materiales (id, partida_id, tipo, titulo, creador_id, seccion, acceso) VALUES ('m1', 'p1', 'nota', 'T', 'u0', 'grupo', '[{"usuarioId":"u1","nivel":"ver"},{"usuarioId":"u2","nivel":"editar"}]')`,
  ).run();
  migrate(db);
  const oculta = (id: string) => Number(db.prepare("SELECT oculta FROM fichas WHERE id = ?").get(id)?.oculta);
  assert.equal(oculta("f1"), 1, "el NPC estaba oculto: su ficha sigue sin verse");
  assert.equal(oculta("f2"), 0);
  assert.deepEqual(JSON.parse(String(db.prepare("SELECT acceso FROM materiales WHERE id = 'm1'").get()?.acceso)), [
    { usuarioId: "u1", nivel: "observador" },
    { usuarioId: "u2", nivel: "propietario" },
  ]);
  assert.equal(db.prepare("SELECT acceso FROM npcs WHERE id = 'n1'").get()?.acceso, "[]");
});
