import { test } from "node:test";
import assert from "node:assert/strict";
import { FreeRollBody, IDLE_MUSIC, type PjDto } from "@pyv/shared";
import { HostTokens } from "../src/auth";
import { HttpError } from "../src/errors";
import * as svc from "../src/services";
import { buildSnapshot } from "../src/snapshot";
import { makeCtx, setup, testSheet, type TestSheet } from "./helpers";

/** Hoja de un PJ del sistema de prueba (el núcleo la trata como `unknown`). */
const sh = (pj: PjDto) => pj.sheet as TestSheet;

const rejects = (fn: () => unknown, status: number, match?: RegExp) => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof HttpError, `se esperaba HttpError y llegó ${String(e)}`);
    assert.equal(e.status, status, e.message);
    if (match) assert.match(e.message, match);
    return;
  }
  assert.fail(`se esperaba HttpError ${status}, pero no lanzó nada`);
};

// --- autenticación ------------------------------------------------------------

test("login: usuarios normales entran; el Narrador anfitrión NO puede entrar con contraseña", async () => {
  const { ctx } = makeCtx();
  const { partida } = await setup(ctx);
  const ok = await svc.login(ctx, { partidaId: partida.id, nombre: "ana", password: "secreto1" }); // sin distinguir mayúsculas
  assert.equal(ok.usuario.rol, "jugador");
  assert.ok(svc.authenticate(ctx, ok.token));

  await assert.rejects(svc.login(ctx, { partidaId: partida.id, nombre: "Ana", password: "mala" }), /incorrectos/);
  await assert.rejects(svc.login(ctx, { partidaId: partida.id, nombre: "Nadie", password: "secreto1" }), /incorrectos/);
  for (const pw of ["", "x", "null", "secreto1"])
    await assert.rejects(svc.login(ctx, { partidaId: partida.id, nombre: "Narradora", password: pw || "-" }), /incorrectos/);
});

test("login y sesiones fallan si la Partida está cerrada", async () => {
  const { ctx, rec } = makeCtx();
  const { partida } = await setup(ctx);
  const { token } = await svc.login(ctx, { partidaId: partida.id, nombre: "Ana", password: "secreto1" });
  svc.setActiva(ctx, partida.id, false);
  assert.deepEqual(rec.cerradas, [partida.id]);
  assert.equal(svc.authenticate(ctx, token), null);
  await assert.rejects(svc.login(ctx, { partidaId: partida.id, nombre: "Ana", password: "secreto1" }), /incorrectos/);
  assert.deepEqual(svc.listPartidasActivas(ctx), []);
});

test("token del anfitrión: un solo uso y caduca", async () => {
  const { ctx, clock } = makeCtx();
  const { partida } = await setup(ctx);
  const tokens = new HostTokens(() => clock.t);
  const t = tokens.mint(partida.id);
  const s = svc.exchangeHostToken(ctx, tokens, t);
  assert.equal(s.usuario.esAnfitrion, true);
  assert.equal(svc.authenticate(ctx, s.token)?.rol, "narrador");
  assert.throws(() => svc.exchangeHostToken(ctx, tokens, t), /inválido/); // segundo uso
  const t2 = tokens.mint(partida.id);
  clock.t += 61_000;
  assert.throws(() => svc.exchangeHostToken(ctx, tokens, t2), /caducado/);
  assert.throws(() => svc.exchangeHostToken(ctx, tokens, "inventado-inventado"), /inválido/);
});

test("sesión manipulada o de otro secreto se rechaza", async () => {
  const { ctx } = makeCtx();
  const { partida } = await setup(ctx);
  const { token } = await svc.login(ctx, { partidaId: partida.id, nombre: "Ana", password: "secreto1" });
  assert.ok(svc.authenticate(ctx, token));
  const [body, sig] = token.split(".");
  assert.equal(svc.authenticate(ctx, `${body}x.${sig}`), null);
  assert.equal(svc.authenticate(ctx, undefined), null);
  assert.equal(svc.authenticate({ ...ctx, secret: Buffer.alloc(32, 9) }, token), null);
});

test("usuarios: nombre único y no se puede borrar al anfitrión", async () => {
  const { ctx } = makeCtx();
  const { narrador, ana } = await setup(ctx);
  await assert.rejects(svc.createUser(ctx, narrador, { nombre: "ANA", password: "secreto1", rol: "jugador" }), /Ya existe/);
  await assert.rejects(svc.createUser(ctx, ana, { nombre: "X", password: "secreto1", rol: "jugador" }), /Solo el Narrador/);
  rejects(() => svc.deleteUser(ctx, narrador, narrador.id), 403);
});

// --- personajes (con el sistema de prueba de helpers.ts) ---------------------------

test("jugador crea PJ solo siguiendo las reglas de creación del sistema; el Narrador puede saltárselas", async () => {
  const { ctx } = makeCtx();
  const { narrador, ana, beto } = await setup(ctx);
  rejects(() => svc.createPj(ctx, ana, { sheet: testSheet({ secreto: "x" }) }), 422, /secreto/);
  rejects(() => svc.createPj(ctx, ana, { sheet: { nombre: "" } }), 422);
  rejects(() => svc.createPj(ctx, ana, { sheet: testSheet(), duenoId: beto.id }), 403);

  const pj = svc.createPj(ctx, ana, { sheet: testSheet() });
  assert.equal(pj.duenoId, ana.id);
  assert.equal(pj.nombre, "★ Lía", "el nombre lo calcula el sistema");

  const libre = svc.createPj(ctx, narrador, { sheet: testSheet({ nombre: "Profesor", secreto: "x" }), duenoId: beto.id });
  assert.equal(libre.duenoId, beto.id);
  rejects(() => svc.createPj(ctx, narrador, { sheet: testSheet(), duenoId: "no-existe" }), 422);
});

test("las hojas alimentan el catálogo del sistema sin duplicarse", async () => {
  const { ctx } = makeCtx();
  const { narrador, ana, beto } = await setup(ctx);
  svc.createPj(ctx, ana, { sheet: testSheet({ trucos: ["Salto", "Finta"] }) });
  svc.createPj(ctx, beto, { sheet: testSheet({ nombre: "Teo", trucos: ["salto"] }) }); // misma clave que "Salto"
  const trucos = buildSnapshot(ctx, narrador).catalogo.map((e) => (e.data as { truco: string }).truco).sort();
  assert.deepEqual(trucos, ["Finta", "Salto"]);
});

test("un jugador no ve ni toca los PJs de otro jugador", async () => {
  const { ctx } = makeCtx();
  const { narrador, ana, beto } = await setup(ctx);
  const pjAna = svc.createPj(ctx, ana, { sheet: testSheet() });
  assert.equal(buildSnapshot(ctx, ana).pjs.length, 1);
  assert.equal(buildSnapshot(ctx, beto).pjs.length, 0);
  assert.equal(buildSnapshot(ctx, narrador).pjs.length, 1);
  rejects(() => svc.patchPj(ctx, beto, pjAna.id, { sheet: { puntos: 0 } }), 404);
  rejects(() => svc.progressPj(ctx, beto, pjAna.id, { truco: "x" }), 404);
  rejects(() => svc.deletePj(ctx, ana, pjAna.id), 403);
});

test("edición: sin edición libre solo las claves seguras del sistema; el Narrador puede activarla", async () => {
  const { ctx } = makeCtx();
  const { narrador, ana } = await setup(ctx);
  const pj = svc.createPj(ctx, ana, { sheet: testSheet() });

  const upd = svc.patchPj(ctx, ana, pj.id, { sheet: { puntos: 2, dormido: true } });
  assert.deepEqual([sh(upd).puntos, sh(upd).dormido, sh(upd).nombre], [2, true, "Lía"], "el PATCH no pisa el resto");

  rejects(() => svc.patchPj(ctx, ana, pj.id, { sheet: { nombre: "Otra" } }), 403, /nombre/);
  rejects(() => svc.patchPj(ctx, ana, pj.id, { sheet: { trucos: [] } }), 403, /trucos/);
  rejects(() => svc.patchPj(ctx, ana, pj.id, { imagen: "abc.png" }), 403);
  rejects(() => svc.patchPj(ctx, ana, pj.id, { edicionLibre: true }), 403);
  rejects(() => svc.patchPj(ctx, ana, pj.id, { duenoId: ana.id }), 403);
  rejects(() => svc.patchPj(ctx, ana, pj.id, { sheet: { puntos: 99 } }), 422); // valores inválidos

  svc.patchPj(ctx, narrador, pj.id, { edicionLibre: true });
  const free = svc.patchPj(ctx, ana, pj.id, { sheet: { nombre: "Lía Luna", trucos: ["Salto", "Salto"] } });
  assert.equal(free.nombre, "★ Lía Luna");
  assert.deepEqual(sh(free).trucos, ["Salto"], "normalize del sistema");
  rejects(() => svc.patchPj(ctx, ana, pj.id, { duenoId: null }), 403);
});

test("edición libre por defecto de la Partida se hereda a los PJs nuevos", async () => {
  const { ctx } = makeCtx();
  const { partida, ana } = await setup(ctx);
  assert.equal(svc.createPj(ctx, ana, { sheet: testSheet() }).edicionLibre, false);
  svc.patchPartida(ctx, partida.id, { edicionLibreDefault: true });
  assert.equal(svc.createPj(ctx, ana, { sheet: testSheet({ nombre: "Otro" }) }).edicionLibre, true);
});

test("progreso del sistema: lo aplica el dueño sin edición libre y lo ganado entra al catálogo", async () => {
  const { ctx } = makeCtx();
  const { ana } = await setup(ctx);
  const pj = svc.createPj(ctx, ana, { sheet: testSheet({ puntos: 2 }) });
  rejects(() => svc.progressPj(ctx, ana, pj.id, { truco: "Voltereta" }), 422, /3 puntos/);
  rejects(() => svc.progressPj(ctx, ana, pj.id, { truco: "" }), 422);
  svc.patchPj(ctx, ana, pj.id, { sheet: { puntos: 4 } });
  const after = svc.progressPj(ctx, ana, pj.id, { truco: "Voltereta" });
  assert.equal(sh(after).puntos, 1);
  assert.deepEqual(sh(after).trucos, ["Voltereta"]);
  assert.ok(buildSnapshot(ctx, ana).catalogo.some((e) => (e.data as { truco: string }).truco === "Voltereta"));
});

test("al borrar un usuario sus PJs quedan sin dueño", async () => {
  const { ctx } = makeCtx();
  const { narrador, ana } = await setup(ctx);
  const pj = svc.createPj(ctx, ana, { sheet: testSheet() });
  svc.deleteUser(ctx, narrador, ana.id);
  assert.equal(buildSnapshot(ctx, narrador).pjs.find((p) => p.id === pj.id)?.duenoId, null);
});

// --- tiradas --------------------------------------------------------------------

const golpe = (pjId: string, privada = false, bonus = 0) => ({ pjId, movimientoId: "golpe", opciones: { bonus }, privada });

test("movimiento: lo resuelve el sistema en el servidor, con etiquetas, y se emite", async () => {
  const { ctx, rec, dice } = makeCtx();
  const { ana } = await setup(ctx);
  const pj = svc.createPj(ctx, ana, { sheet: testSheet() }); // puntos 5
  dice.push(4);
  const t = svc.rollMovement(ctx, ana, golpe(pj.id, false, 1));
  assert.deepEqual([t.dados, t.modificador, t.total, t.resultado, t.resultadoEtiqueta, t.resultadoTono], [[4], 6, 10, "bien", "¡Bien!", "exito"]);
  assert.deepEqual([t.pjNombre, t.movimientoNombre, t.stat, t.statEtiqueta, t.caras], ["★ Lía", "Golpe", "puntos", "Puntos", 10]);
  assert.equal(t.visibilidad, "publica");
  assert.equal(rec.tiradas.at(-1)?.id, t.id);

  dice.push(1);
  assert.equal(svc.rollMovement(ctx, ana, golpe(pj.id)).resultado, "mal");
  rejects(() => svc.rollMovement(ctx, ana, { ...golpe(pj.id), movimientoId: "otro" }), 422, /golpe/);
  rejects(() => svc.rollMovement(ctx, ana, golpe(pj.id, false, 9)), 422);
});

test("movimiento: solo con tu PJ y no si no puede actuar (el Narrador sí puede)", async () => {
  const { ctx } = makeCtx();
  const { narrador, ana, beto } = await setup(ctx);
  const pj = svc.createPj(ctx, ana, { sheet: testSheet() });
  rejects(() => svc.rollMovement(ctx, beto, golpe(pj.id)), 403);
  svc.patchPj(ctx, ana, pj.id, { sheet: { dormido: true } });
  rejects(() => svc.rollMovement(ctx, ana, golpe(pj.id)), 409, /no puede actuar/);
  assert.doesNotThrow(() => svc.rollMovement(ctx, narrador, golpe(pj.id)));
});

test("visibilidad de tiradas: públicas, privadas de jugador y privadas de Narrador", async () => {
  const { ctx } = makeCtx();
  const { narrador, ana, beto } = await setup(ctx);
  const pj = svc.createPj(ctx, ana, { sheet: testSheet() });
  const pub = svc.rollMovement(ctx, ana, golpe(pj.id));
  const priv = svc.rollMovement(ctx, ana, golpe(pj.id, true));
  const sec = svc.rollFree(ctx, narrador, { cantidad: 2, caras: 20, modificador: 0, privada: true });
  const open = svc.rollFree(ctx, narrador, { cantidad: 1, caras: 6, modificador: 0, privada: false });
  assert.equal(priv.visibilidad, "autor_narradores");
  assert.equal(sec.visibilidad, "narradores");
  const ids = (a: typeof ana) => buildSnapshot(ctx, a).tiradas.map((t) => t.id);
  assert.deepEqual(new Set(ids(narrador)), new Set([pub.id, priv.id, sec.id, open.id]));
  assert.deepEqual(new Set(ids(ana)), new Set([pub.id, priv.id, open.id])); // ve la suya privada, no la del Narrador
  assert.deepEqual(new Set(ids(beto)), new Set([pub.id, open.id]));
});

test("tirada libre del Narrador: n dados de cualquier tipo", async () => {
  const { ctx, dice } = makeCtx();
  const { narrador } = await setup(ctx);
  dice.push(10, 20, 30);
  const t = svc.rollFree(ctx, narrador, { cantidad: 3, caras: 100, modificador: 0, privada: false });
  assert.equal(t.total, 60);
  assert.equal(t.caras, 100);
  assert.equal(t.resultado, null);
  assert.equal(t.detalle, "3d100");
});

test("tirada libre de un jugador: con modificador; privada = él y los Narradores", async () => {
  const { ctx, dice } = makeCtx();
  const { narrador, ana, beto } = await setup(ctx);
  dice.push(3, 5, 8);
  const t = svc.rollFree(ctx, ana, { cantidad: 3, caras: 8, modificador: 2, privada: false });
  assert.deepEqual(t.dados, [3, 5, 8]);
  assert.equal(t.modificador, 2);
  assert.equal(t.total, 18);
  assert.equal(t.detalle, "3d8+2");
  assert.equal(t.autorId, ana.id);
  dice.push(4);
  const neg = svc.rollFree(ctx, ana, { cantidad: 1, caras: 20, modificador: -5, privada: true });
  assert.equal(neg.total, -1);
  assert.equal(neg.detalle, "1d20-5");
  assert.equal(neg.visibilidad, "autor_narradores");
  const ids = (a: typeof ana) => buildSnapshot(ctx, a).tiradas.map((x) => x.id);
  assert.ok(ids(narrador).includes(neg.id));
  assert.ok(ids(ana).includes(neg.id));
  assert.ok(!ids(beto).includes(neg.id));
  assert.ok(ids(beto).includes(t.id));
});

test("tirada libre: el esquema limita cantidad, dado y modificador", () => {
  assert.equal(FreeRollBody.safeParse({ cantidad: 20, caras: 20, modificador: 20 }).success, true);
  assert.equal(FreeRollBody.safeParse({ cantidad: 21, caras: 20 }).success, false);
  assert.equal(FreeRollBody.safeParse({ cantidad: 1, caras: 7 }).success, false);
  assert.equal(FreeRollBody.safeParse({ cantidad: 1, caras: 6, modificador: -21 }).success, false);
  assert.equal(FreeRollBody.parse({ cantidad: 1, caras: 6 }).modificador, 0);
});

// --- escenas y fichas ----------------------------------------------------------

test("cuadrícula: casillas enteras, dentro de los límites y sin dos fichas en la misma casilla", async () => {
  const { ctx } = makeCtx();
  const { narrador, ana, beto } = await setup(ctx);
  const a = svc.createPj(ctx, ana, { sheet: testSheet() });
  const b = svc.createPj(ctx, beto, { sheet: testSheet({ nombre: "Teo" }) });
  const grid = svc.createEscena(ctx, narrador, { nombre: "Gran Comedor", tipo: "cuadricula", filas: 5, columnas: 8, abierta: true });
  svc.proyectarEscena(ctx, narrador, grid.id);

  const fa = svc.createFicha(ctx, narrador, grid.id, { ref: { tipo: "pj", id: a.id }, x: 2, y: 2, oculta: false });
  rejects(() => svc.createFicha(ctx, narrador, grid.id, { ref: { tipo: "pj", id: b.id }, x: 2, y: 2, oculta: false }), 409, /ocupada/);
  rejects(() => svc.createFicha(ctx, narrador, grid.id, { ref: { tipo: "pj", id: b.id }, x: 8, y: 0, oculta: false }), 422);
  rejects(() => svc.createFicha(ctx, narrador, grid.id, { ref: { tipo: "pj", id: b.id }, x: 1.5, y: 0, oculta: false }), 422);
  rejects(() => svc.createFicha(ctx, narrador, grid.id, { ref: { tipo: "pj", id: a.id }, x: 0, y: 0, oculta: false }), 409, /ya tiene/);
  const fb = svc.createFicha(ctx, narrador, grid.id, { ref: { tipo: "pj", id: b.id }, x: 3, y: 2, oculta: false });

  rejects(() => svc.moveFicha(ctx, ana, fa.id, { x: 3, y: 2 }), 409, /ocupada/); // no puede pisar a Teo
  const moved = svc.moveFicha(ctx, ana, fa.id, { x: 2, y: 3 });
  assert.deepEqual([moved.x, moved.y], [2, 3]);
  rejects(() => svc.moveFicha(ctx, ana, fa.id, { x: 99, y: 3 }), 422);
  // reducir la cuadrícula con fichas fuera se rechaza
  rejects(() => svc.patchEscena(ctx, narrador, grid.id, { columnas: 3 }), 409);
  assert.equal(fb.x, 3);
});

test("escena libre: coordenadas 0..1", async () => {
  const { ctx } = makeCtx();
  const { narrador, ana } = await setup(ctx);
  const a = svc.createPj(ctx, ana, { sheet: testSheet() });
  const libre = svc.createEscena(ctx, narrador, { nombre: "Mapa", tipo: "imagen", filas: 10, columnas: 10, abierta: true });
  svc.createFicha(ctx, narrador, libre.id, { ref: { tipo: "pj", id: a.id }, x: 0.25, y: 0.75, oculta: false });
  rejects(() => svc.createFicha(ctx, narrador, libre.id, { ref: { tipo: "npc", id: "x" }, x: 2, y: 0, oculta: false }), 404);
});

test("fichas: el jugador solo mueve las suyas, en la escena proyectada y si no están ocultas", async () => {
  const { ctx, rec } = makeCtx();
  const { narrador, ana, beto } = await setup(ctx);
  const a = svc.createPj(ctx, ana, { sheet: testSheet() });
  const b = svc.createPj(ctx, beto, { sheet: testSheet({ nombre: "Teo" }) });
  const e1 = svc.createEscena(ctx, narrador, { nombre: "A", tipo: "imagen", filas: 1, columnas: 1, abierta: true });
  const e2 = svc.createEscena(ctx, narrador, { nombre: "B", tipo: "imagen", filas: 1, columnas: 1, abierta: true });
  const fa = svc.createFicha(ctx, narrador, e1.id, { ref: { tipo: "pj", id: a.id }, x: 0.1, y: 0.1, oculta: false });
  const fb = svc.createFicha(ctx, narrador, e1.id, { ref: { tipo: "pj", id: b.id }, x: 0.5, y: 0.5, oculta: false });
  const fa2 = svc.createFicha(ctx, narrador, e2.id, { ref: { tipo: "pj", id: a.id }, x: 0.2, y: 0.2, oculta: false });

  rejects(() => svc.moveFicha(ctx, ana, fa.id, { x: 0.3, y: 0.3 }), 403); // la escena aún no está proyectada
  svc.proyectarEscena(ctx, narrador, e1.id);
  assert.doesNotThrow(() => svc.moveFicha(ctx, ana, fa.id, { x: 0.3, y: 0.3 }));
  assert.equal(rec.fichas.at(-1)?.soloNarradores, false);
  rejects(() => svc.moveFicha(ctx, ana, fb.id, { x: 0.3, y: 0.3 }), 403); // ficha de Beto
  rejects(() => svc.moveFicha(ctx, ana, fa2.id, { x: 0.3, y: 0.3 }), 403); // otra escena
  rejects(() => svc.moveFicha(ctx, ana, fa.id, { oculta: true }), 403); // solo el Narrador oculta
  rejects(() => svc.deleteFicha(ctx, ana, fa.id), 403);

  svc.moveFicha(ctx, narrador, fa.id, { oculta: true }); // oculta → ya no la puede mover
  rejects(() => svc.moveFicha(ctx, ana, fa.id, { x: 0.4, y: 0.4 }), 403);
});

test("snapshot de jugador: solo la escena proyectada y sus fichas visibles; NPC oculto oculta sus fichas", async () => {
  const { ctx, rec } = makeCtx();
  const { narrador, ana } = await setup(ctx);
  const a = svc.createPj(ctx, ana, { sheet: testSheet() });
  const dragon = svc.createNpc(ctx, narrador, { nombre: "Dragón", notas: "secreto", oculto: true });
  const elfo = svc.createNpc(ctx, narrador, { nombre: "Gnomo", notas: "", oculto: false });
  const e1 = svc.createEscena(ctx, narrador, { nombre: "Bosque", tipo: "imagen", filas: 1, columnas: 1, abierta: true });
  const e2 = svc.createEscena(ctx, narrador, { nombre: "Mazmorra", tipo: "imagen", filas: 1, columnas: 1, abierta: true });
  svc.createFicha(ctx, narrador, e1.id, { ref: { tipo: "pj", id: a.id }, x: 0.1, y: 0.1, oculta: false });
  const fd = svc.createFicha(ctx, narrador, e1.id, { ref: { tipo: "npc", id: dragon.id }, x: 0.5, y: 0.5, oculta: false });
  svc.createFicha(ctx, narrador, e1.id, { ref: { tipo: "npc", id: elfo.id }, x: 0.6, y: 0.6, oculta: false });
  svc.createFicha(ctx, narrador, e2.id, { ref: { tipo: "npc", id: elfo.id }, x: 0.6, y: 0.6, oculta: false });

  // sin proyectar: el jugador no ve escenas ni fichas
  let snap = buildSnapshot(ctx, ana);
  assert.equal(snap.escenas.length, 0);
  assert.equal(snap.fichas.length, 0);

  svc.proyectarEscena(ctx, narrador, e1.id);
  snap = buildSnapshot(ctx, ana);
  assert.deepEqual(snap.escenas.map((e) => e.nombre), ["Bosque"]);
  assert.deepEqual(snap.fichas.map((f) => f.nombre).sort(), ["Gnomo", "★ Lía"]); // sin Dragón
  assert.deepEqual(snap.npcs.map((n) => n.nombre), ["Gnomo"]);
  assert.equal(snap.escenaProyectadaId, e1.id);

  // mover una ficha de NPC oculto solo se emite a Narradores
  svc.moveFicha(ctx, narrador, fd.id, { x: 0.7, y: 0.7 });
  assert.equal(rec.fichas.at(-1)?.soloNarradores, true);

  // el Narrador ve todo
  const n = buildSnapshot(ctx, narrador);
  assert.equal(n.escenas.length, 2);
  assert.equal(n.fichas.length, 4);
  assert.equal(n.playlists.length, 0);

  // al revelar al NPC, aparece para los jugadores
  svc.patchNpc(ctx, narrador, dragon.id, { oculto: false });
  assert.ok(buildSnapshot(ctx, ana).fichas.some((f) => f.nombre === "Dragón"));
});

test("borrar PJ/NPC/escena limpia fichas y desproyecta", async () => {
  const { ctx } = makeCtx();
  const { narrador, ana } = await setup(ctx);
  const a = svc.createPj(ctx, ana, { sheet: testSheet() });
  const e = svc.createEscena(ctx, narrador, { nombre: "X", tipo: "imagen", filas: 1, columnas: 1, abierta: true });
  svc.createFicha(ctx, narrador, e.id, { ref: { tipo: "pj", id: a.id }, x: 0, y: 0, oculta: false });
  svc.proyectarEscena(ctx, narrador, e.id);
  svc.deletePj(ctx, narrador, a.id);
  assert.equal(buildSnapshot(ctx, narrador).fichas.length, 0);
  svc.deleteEscena(ctx, narrador, e.id);
  assert.equal(buildSnapshot(ctx, narrador).escenaProyectadaId, null);
  rejects(() => svc.proyectarEscena(ctx, ana, null), 403);
});

// --- materiales -----------------------------------------------------------------

test("materiales: las Notas de grupo se ven por defecto; las del Narrador solo a quien se asigne", async () => {
  const { ctx } = makeCtx();
  const { narrador, ana, beto } = await setup(ctx);
  const grupo = svc.createMaterial(ctx, ana, { tipo: "nota", titulo: "Mi diario", contenido: "hola", seccion: "grupo", acceso: [] });
  assert.equal(grupo.visibleATodos, true);
  rejects(() => svc.createMaterial(ctx, ana, { tipo: "nota", titulo: "x", contenido: "", seccion: "narrador", acceso: [] }), 403);
  rejects(() => svc.createMaterial(ctx, ana, { tipo: "pdf", titulo: "x", contenido: "", seccion: "grupo", acceso: [] }), 422, /archivo/);

  const secreto = svc.createMaterial(ctx, narrador, { tipo: "nota", titulo: "Plan", contenido: "...", seccion: "narrador", acceso: [{ usuarioId: ana.id, nivel: "ver" }] });
  assert.equal(secreto.visibleATodos, false);
  const titles = (a: typeof ana) => buildSnapshot(ctx, a).materiales.map((m) => m.titulo).sort();
  assert.deepEqual(titles(ana), ["Mi diario", "Plan"]);
  assert.deepEqual(titles(beto), ["Mi diario"]);
  assert.deepEqual(titles(narrador), ["Mi diario", "Plan"]);

  // Ana puede ocultar su nota a los demás, el Narrador la sigue viendo
  svc.patchMaterial(ctx, ana, grupo.id, { visibleATodos: false });
  assert.deepEqual(titles(beto), []);
  assert.deepEqual(titles(narrador), ["Mi diario", "Plan"]);
  // o compartirla con Beto en modo edición
  svc.patchMaterial(ctx, ana, grupo.id, { acceso: [{ usuarioId: beto.id, nivel: "editar" }] });
  assert.deepEqual(titles(beto), ["Mi diario"]);
  assert.doesNotThrow(() => svc.patchMaterial(ctx, beto, grupo.id, { contenido: "editado por Beto" }));
  rejects(() => svc.patchMaterial(ctx, beto, grupo.id, { visibleATodos: true }), 403); // no cambia accesos
  rejects(() => svc.deleteMaterial(ctx, beto, grupo.id), 403);
  rejects(() => svc.patchMaterial(ctx, beto, secreto.id, { contenido: "x" }), 404); // ni siquiera sabe que existe
  rejects(() => svc.createMaterial(ctx, narrador, { tipo: "nota", titulo: "x", contenido: "", seccion: "narrador", acceso: [{ usuarioId: "fantasma", nivel: "ver" }] }), 422);
  svc.deleteMaterial(ctx, ana, grupo.id);
  assert.deepEqual(titles(narrador), ["Plan"]);
});

// --- música ----------------------------------------------------------------------

test("música: el Narrador controla; el estado sincronizado se emite con la pista resuelta", async () => {
  const { ctx, rec, clock } = makeCtx();
  const { narrador, ana } = await setup(ctx);
  const pl = svc.createPlaylist(ctx, narrador, "Ambiente");
  const pista = svc.addPista(ctx, narrador, pl.id, { nombre: "Tormenta", archivo: "abc-123.mp3" });
  rejects(() => svc.controlMusic(ctx, ana, { accion: "play", pistaId: pista.id }), 403);
  rejects(() => svc.controlMusic(ctx, narrador, { accion: "play" }), 422, /pista/);
  rejects(() => svc.controlMusic(ctx, narrador, { accion: "play", pistaId: "nope" }), 404);

  clock.t = 5_000;
  const m = svc.controlMusic(ctx, narrador, { accion: "play", pistaId: pista.id });
  assert.equal(m.reproduciendo, true);
  assert.equal(m.pista?.archivo, "abc-123.mp3");
  assert.equal(rec.musica.at(-1)?.pistaId, pista.id);

  clock.t = 9_000;
  const paused = svc.controlMusic(ctx, narrador, { accion: "pause" });
  assert.equal(paused.posicionMs, 4_000);

  // los jugadores ven lo que suena, pero no la biblioteca
  const snap = buildSnapshot(ctx, ana);
  assert.equal(snap.musica.pista?.nombre, "Tormenta");
  assert.deepEqual(snap.playlists, []);
  assert.equal(buildSnapshot(ctx, narrador).playlists[0]?.pistas.length, 1);

  // borrar la pista que suena detiene la música
  svc.deletePista(ctx, narrador, pista.id);
  assert.deepEqual({ ...buildSnapshot(ctx, narrador).musica, actualizadoEn: 0, pista: null }, { ...IDLE_MUSIC, pista: null });
});

test("partida: borrar en cascada elimina todo", async () => {
  const { ctx } = makeCtx();
  const { partida, ana } = await setup(ctx);
  svc.createPj(ctx, ana, { sheet: testSheet() });
  svc.deletePartida(ctx, partida.id);
  for (const t of ["usuarios", "pjs", "hechizos", "catalogo", "tiradas"])
    assert.equal((ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n, 0, t);
});

test("chat: público para todos; susurro solo para autor y destinatario (el Narrador ajeno no lo ve)", async () => {
  const { ctx, rec } = makeCtx();
  const { narrador, ana, beto, segunda } = await setup(ctx);
  const pub = svc.sendMessage(ctx, ana, { texto: "  Hola a todos  " });
  assert.equal(pub.texto, "Hola a todos");
  assert.equal(pub.remitenteNombre, "Ana");
  const aBeto = svc.sendMessage(ctx, ana, { texto: "psst", destinatarioId: beto.id });
  const aNarrador = svc.sendMessage(ctx, beto, { texto: "una duda", destinatarioId: narrador.id });
  assert.equal(aBeto.destinatarioNombre, "Beto");
  assert.equal(rec.mensajes.length, 3);
  const ids = (a: typeof ana) => buildSnapshot(ctx, a).mensajes.map((m) => m.id);
  assert.deepEqual(new Set(ids(ana)), new Set([pub.id, aBeto.id]));
  assert.deepEqual(new Set(ids(beto)), new Set([pub.id, aBeto.id, aNarrador.id]));
  assert.deepEqual(new Set(ids(narrador)), new Set([pub.id, aNarrador.id])); // no ve el susurro Ana→Beto
  assert.deepEqual(new Set(ids(segunda)), new Set([pub.id])); // otro Narrador tampoco ve lo de su colega
  rejects(() => svc.sendMessage(ctx, ana, { texto: "yo", destinatarioId: ana.id }), 422);
  rejects(() => svc.sendMessage(ctx, ana, { texto: "x", destinatarioId: "no-existe" }), 422);
});

test("chat: hablar como un PJ propio (el Narrador, como cualquiera)", async () => {
  const { ctx } = makeCtx();
  const { narrador, ana, beto } = await setup(ctx);
  const pjAna = svc.createPj(ctx, ana, { sheet: testSheet({ nombre: "Luna" }) });
  const m = svc.sendMessage(ctx, ana, { texto: "Hola", pjId: pjAna.id });
  assert.equal(m.remitenteNombre, "★ Luna");
  assert.equal(m.autorNombre, "Ana");
  assert.equal(m.pjId, pjAna.id);
  rejects(() => svc.sendMessage(ctx, beto, { texto: "soy Luna", pjId: pjAna.id }), 403);
  assert.equal(svc.sendMessage(ctx, narrador, { texto: "Luna dice...", pjId: pjAna.id }).remitenteNombre, "★ Luna");
});

test("limpiar registro: solo el Narrador; borra tiradas y chat (incluidos susurros) para todos", async () => {
  const { ctx, rec } = makeCtx();
  const { narrador, ana, beto } = await setup(ctx);
  const pj = svc.createPj(ctx, ana, { sheet: testSheet() });
  svc.rollMovement(ctx, ana, golpe(pj.id));
  svc.sendMessage(ctx, ana, { texto: "hola" });
  svc.sendMessage(ctx, ana, { texto: "psst", destinatarioId: beto.id });
  rejects(() => svc.clearLog(ctx, ana), 403);
  assert.equal(buildSnapshot(ctx, ana).mensajes.length, 2);
  svc.clearLog(ctx, narrador);
  for (const a of [narrador, ana, beto]) {
    const s = buildSnapshot(ctx, a);
    assert.equal(s.tiradas.length, 0);
    assert.equal(s.mensajes.length, 0);
  }
  assert.ok(rec.changed.some((c) => c.scopes.includes("chat") && c.scopes.includes("tiradas")));
});
