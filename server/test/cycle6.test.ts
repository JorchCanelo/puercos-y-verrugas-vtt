// Ciclo 6: cambiar contraseñas (anfitrión), carpetas de NPCs y materiales, y fichas que ponen los jugadores.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { NpcBody } from "@pyv/shared";
import { migrate, type Db } from "../src/db";
import { HttpError } from "../src/errors";
import * as svc from "../src/services";
import { buildSnapshot } from "../src/snapshot";
import { makeCtx, setup, testSheet } from "./helpers";

const rejectsAsync = async (fn: () => Promise<unknown>, status: number, match?: RegExp) => {
  try {
    await fn();
  } catch (e) {
    assert.ok(e instanceof HttpError, `se esperaba HttpError y llegó ${String(e)}`);
    assert.equal(e.status, status, e.message);
    if (match) assert.match(e.message, match);
    return;
  }
  assert.fail(`se esperaba un error ${status}`);
};
const rejects = (fn: () => unknown, status: number, match?: RegExp) => rejectsAsync(async () => fn(), status, match);

test("solo el anfitrión cambia contraseñas; la anterior deja de valer y sus sesiones abiertas también", async () => {
  const { ctx, rec } = makeCtx();
  const { partida, narrador, ana, segunda } = await setup(ctx);
  const login = (password: string) => svc.login(ctx, { partidaId: partida.id, nombre: "Ana", password });
  const { token } = await login("secreto1");
  assert.ok(svc.authenticate(ctx, token));

  await rejectsAsync(() => svc.setUserPassword(ctx, segunda, ana.id, "nueva123"), 403, /anfitrión/); // otro Narrador no
  await rejectsAsync(() => svc.setUserPassword(ctx, ana, ana.id, "nueva123"), 403); // ni el propio jugador
  await rejectsAsync(() => svc.setUserPassword(ctx, narrador, narrador.id, "nueva123"), 403, /panel/);

  await svc.setUserPassword(ctx, narrador, ana.id, "nueva123");
  assert.equal(svc.authenticate(ctx, token), null, "la sesión abierta con la contraseña anterior se cierra");
  assert.deepEqual(rec.expulsados, [ana.id]);
  await rejectsAsync(() => login("secreto1"), 401);
  const again = await login("nueva123");
  assert.equal(svc.authenticate(ctx, again.token)?.id, ana.id);

  await svc.setUserPassword(ctx, narrador, segunda.id, "otra1234"); // también a otros Narradores
});

test("migración 4: los datos se conservan, sin carpeta, y las sesiones de antes siguen valiendo", async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  const db = raw as unknown as Db;
  migrate(db, 3);
  db.prepare("INSERT INTO partidas (id, nombre, activa, musica, creada_en, sistema) VALUES ('p1', 'Antigua', 1, '{}', 1, 'prueba')").run();
  db.prepare("INSERT INTO usuarios (id, partida_id, nombre, rol, es_anfitrion) VALUES ('u1', 'p1', 'N', 'narrador', 1)").run();
  db.prepare("INSERT INTO npcs (id, partida_id, nombre) VALUES ('n1', 'p1', 'Gnomo')").run();
  db.prepare("INSERT INTO materiales (id, partida_id, tipo, titulo, creador_id, seccion) VALUES ('m1', 'p1', 'nota', 'Diario', 'u1', 'grupo')").run();
  migrate(db);
  assert.equal(db.prepare("SELECT carpeta FROM npcs WHERE id = 'n1'").get()?.carpeta, "");
  assert.equal(db.prepare("SELECT carpeta FROM materiales WHERE id = 'm1'").get()?.carpeta, "");
  assert.equal(db.prepare("SELECT sesion_gen FROM usuarios WHERE id = 'u1'").get()?.sesion_gen, 0);

  // Una cookie emitida antes del ciclo 6 (sin "g") sigue siendo válida: nadie pierde la sesión al actualizar.
  const { ctx } = makeCtx();
  const { partida, narrador } = await setup(ctx);
  const { signSession } = await import("../src/auth");
  const old = signSession(ctx.secret, { u: narrador.id, p: partida.id, e: ctx.now() + 1000 });
  assert.equal(svc.authenticate(ctx, old)?.id, narrador.id);
});

test("carpetas: NPCs y materiales se crean, se mueven y se sacan de carpeta", async () => {
  const { ctx } = makeCtx();
  const { narrador, ana, beto } = await setup(ctx);
  const gnomo = svc.createNpc(ctx, narrador, NpcBody.parse({ nombre: "Gnomo", carpeta: "  Bosque  " })); // como la ruta
  assert.equal(gnomo.carpeta, "Bosque");
  assert.equal(svc.patchNpc(ctx, narrador, gnomo.id, { carpeta: "Pueblo" }).carpeta, "Pueblo");
  assert.equal(svc.patchNpc(ctx, narrador, gnomo.id, { notas: "x" }).carpeta, "Pueblo", "editar otra cosa no la cambia");
  assert.equal(svc.patchNpc(ctx, narrador, gnomo.id, { carpeta: "" }).carpeta, "");

  const nota = svc.createMaterial(ctx, ana, { tipo: "nota", titulo: "Diario", contenido: "", seccion: "grupo", acceso: [{ usuarioId: beto.id, nivel: "observador" }], carpeta: "Pistas" });
  assert.equal(buildSnapshot(ctx, beto).materiales[0]?.carpeta, "Pistas");
  await rejects(() => svc.patchMaterial(ctx, beto, nota.id, { carpeta: "Mías" }), 403); // un observador no organiza
  assert.equal(svc.patchMaterial(ctx, ana, nota.id, { carpeta: "Capítulo 1" }).carpeta, "Capítulo 1");
  assert.equal(svc.patchMaterial(ctx, narrador, nota.id, { carpeta: "" }).carpeta, "");
});

test("fichas: un jugador pone la de su PJ, solo en la escena proyectada y visible; NPCs sin permiso, no", async () => {
  const { ctx } = makeCtx();
  const { narrador, ana, beto } = await setup(ctx);
  const pjAna = svc.createPj(ctx, ana, { sheet: testSheet() });
  const npc = svc.createNpc(ctx, narrador, { nombre: "Gnomo", notas: "", carpeta: "", acceso: [] });
  const bosque = svc.createEscena(ctx, narrador, { nombre: "Bosque", tipo: "cuadricula", filas: 3, columnas: 3, abierta: true });
  const otra = svc.createEscena(ctx, narrador, { nombre: "Cueva", tipo: "imagen", filas: 1, columnas: 1, abierta: true });
  svc.proyectarEscena(ctx, narrador, bosque.id);

  await rejects(() => svc.createFicha(ctx, ana, otra.id, { ref: { tipo: "pj", id: pjAna.id }, x: 0.5, y: 0.5, oculta: false }), 403, /proyectada/);
  await rejects(() => svc.createFicha(ctx, beto, bosque.id, { ref: { tipo: "pj", id: pjAna.id }, x: 0, y: 0, oculta: false }), 403, /tus propios/);
  await rejects(() => svc.createFicha(ctx, ana, bosque.id, { ref: { tipo: "npc", id: npc.id }, x: 0, y: 0, oculta: false }), 403);
  await rejects(() => svc.createFicha(ctx, ana, bosque.id, { ref: { tipo: "pj", id: pjAna.id }, x: 0, y: 0, oculta: true }), 403);

  const f = svc.createFicha(ctx, ana, bosque.id, { ref: { tipo: "pj", id: pjAna.id }, x: 1, y: 2, oculta: false });
  assert.deepEqual([f.x, f.y, f.oculta], [1, 2, false]);
  await rejects(() => svc.createFicha(ctx, ana, bosque.id, { ref: { tipo: "pj", id: pjAna.id }, x: 0, y: 0, oculta: false }), 409); // ya tiene ficha
  await rejects(() => svc.createFicha(ctx, narrador, bosque.id, { ref: { tipo: "npc", id: npc.id }, x: 1, y: 2, oculta: false }), 409); // casilla ocupada
  assert.ok(svc.createFicha(ctx, narrador, otra.id, { ref: { tipo: "npc", id: npc.id }, x: 0.2, y: 0.3, oculta: true }));
});
