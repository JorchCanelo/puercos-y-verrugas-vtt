import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CreatePjBody,
  FreeRollBody,
  IDLE_MUSIC,
  MoveRollBody,
  can,
  canSeeMessage,
  canSeeRoll,
  checkPjPatch,
  musicPositionMs,
  reduceMusic,
  secureDie,
  type Actor,
} from "../src/index";

const narrador: Actor = { id: "n1", rol: "narrador" };
const ana: Actor = { id: "p1", rol: "jugador" };
const beto: Actor = { id: "p2", rol: "jugador" };

/** Claves que un sistema declararía seguras para el jugador (sin edición libre). */
const SAFE = ["notas", "puntos"] as const;

test("secureDie produce 1..n con distribución plausible", () => {
  const counts = new Array(6).fill(0);
  for (let i = 0; i < 6000; i++) counts[secureDie(6) - 1]++;
  for (const c of counts) assert.ok(c > 800 && c < 1200, `conteo fuera de rango: ${c}`);
  assert.throws(() => secureDie(1));
});


test("PJ: un jugador solo ve y edita los suyos", () => {
  const pj = { kind: "pj", ownerId: "p1", edicionLibre: false } as const;
  assert.equal(can(ana, "view", pj), true);
  assert.equal(can(beto, "view", pj), false);
  assert.equal(can(beto, "edit", pj), false);
  assert.equal(can(narrador, "view", pj), true);
  assert.equal(can(ana, "delete", pj), false);
  assert.equal(can(ana, "create", pj), true);
});

test("checkPjPatch: sin edición libre solo campos seguros; con edición libre toda la hoja", () => {
  const locked = { ownerId: "p1", edicionLibre: false };
  const free = { ownerId: "p1", edicionLibre: true };
  assert.equal(checkPjPatch(ana, locked, { sheetKeys: ["notas", "puntos"] }, SAFE), null);
  assert.match(checkPjPatch(ana, locked, { sheetKeys: ["nombre"] }, SAFE) ?? "", /nombre/);
  assert.match(checkPjPatch(ana, locked, { sheetKeys: ["trucos"] }, SAFE) ?? "", /trucos/);
  assert.match(checkPjPatch(ana, locked, { sheetKeys: [], imagen: true }, SAFE) ?? "", /imagen/);
  assert.equal(checkPjPatch(ana, free, { sheetKeys: ["nombre", "trucos"], imagen: true }, SAFE), null);
  assert.ok(checkPjPatch(ana, free, { sheetKeys: [], duenoId: true }, SAFE));
  assert.ok(checkPjPatch(ana, free, { sheetKeys: [], edicionLibre: true }, SAFE));
  assert.ok(checkPjPatch(beto, free, { sheetKeys: ["notas"] }, SAFE));
  assert.equal(checkPjPatch(narrador, locked, { sheetKeys: ["nombre"], duenoId: true, edicionLibre: true }, SAFE), null);
});

test("fichas: su dueño (PJ o propietario de NPC) la pone, mueve y quita, en la escena proyectada y no oculta", () => {
  const base = { kind: "ficha", duenos: ["p1"], oculta: false, proyectada: true } as const;
  for (const action of ["create", "move", "delete"] as const) {
    assert.equal(can(ana, action, base), true, action);
    assert.equal(can(beto, action, base), false, action);
    assert.equal(can(ana, action, { ...base, proyectada: false }), false, action);
    assert.equal(can(ana, action, { ...base, oculta: true }), false, action);
  }
  assert.equal(can(beto, "move", { ...base, duenos: ["p1", "p2"] }), true); // NPC con dos propietarios
  assert.equal(can(ana, "edit", base), false); // ocultar/mostrar: solo Narrador
  assert.equal(can(narrador, "move", { ...base, duenos: [] }), true);
});

test("NPCs: Ninguno no ve sus datos, Observador los ve, Propietario además edita y borra", () => {
  const npc = (nivel?: "observador" | "propietario") => ({ kind: "npc", acceso: nivel ? [{ usuarioId: "p1", nivel }] : [] }) as const;
  assert.equal(can(ana, "view", npc()), false);
  assert.equal(can(ana, "view", npc("observador")), true);
  assert.equal(can(ana, "edit", npc("observador")), false);
  assert.equal(can(ana, "edit", npc("propietario")), true);
  assert.equal(can(ana, "delete", npc("propietario")), true);
  assert.equal(can(ana, "changeAccess", npc("propietario")), false); // los permisos los da el Narrador
  assert.equal(can(ana, "create", npc("propietario")), false);
  assert.equal(can(beto, "view", npc("propietario")), false);
});

test("tiradas: visibilidad pública / narradores / autor+narradores", () => {
  const pub = { autorId: "p1", visibilidad: "publica" } as const;
  const narr = { autorId: "n1", visibilidad: "narradores" } as const;
  const priv = { autorId: "p1", visibilidad: "autor_narradores" } as const;
  assert.equal(canSeeRoll(beto, pub), true);
  assert.equal(canSeeRoll(beto, narr), false);
  assert.equal(canSeeRoll(ana, narr), false);
  assert.equal(canSeeRoll(ana, priv), true);
  assert.equal(canSeeRoll(beto, priv), false);
  assert.equal(canSeeRoll(narrador, priv), true);
  assert.equal(canSeeRoll(narrador, narr), true);
});

test("materiales: creador, acceso asignado, visible a todos, edición solo de notas", () => {
  const base = { kind: "material", tipo: "nota", creadorId: "p1", seccion: "grupo", visibleATodos: false, acceso: [] } as const;
  assert.equal(can(ana, "view", base), true);
  assert.equal(can(beto, "view", base), false);
  assert.equal(can(beto, "view", { ...base, visibleATodos: true }), true);
  const obs = { ...base, acceso: [{ usuarioId: "p2", nivel: "observador" }] } as const;
  const prop = { ...base, acceso: [{ usuarioId: "p2", nivel: "propietario" }] } as const;
  assert.equal(can(beto, "view", obs), true);
  assert.equal(can(beto, "edit", obs), false);
  assert.equal(can(beto, "delete", obs), false);
  assert.equal(can(beto, "edit", prop), true);
  assert.equal(can(beto, "delete", prop), true); // Propietario: borra, comparte y mueve de carpeta
  assert.equal(can(beto, "changeAccess", prop), true);
  assert.equal(can(ana, "edit", { ...base, tipo: "pdf" }), false); // pdf: solo subir
  assert.equal(can(beto, "changeAccess", base), false);
  assert.equal(can(ana, "changeAccess", base), true);
  assert.equal(can(ana, "create", { ...base, seccion: "narrador" }), false);
  assert.equal(can(narrador, "delete", base), true);
});

test("recursos exclusivos del Narrador", () => {
  for (const kind of ["escena", "usuario", "playlist", "musica"] as const) {
    assert.equal(can(ana, "view", { kind }), false, kind);
    assert.equal(can(narrador, "edit", { kind }), true, kind);
  }
});


test("esquemas de API validan dados y datos de entrada", () => {
  assert.equal(FreeRollBody.safeParse({ cantidad: 3, caras: 20 }).success, true);
  assert.equal(FreeRollBody.safeParse({ cantidad: 3, caras: 7 }).success, false);
  assert.equal(FreeRollBody.safeParse({ cantidad: 0, caras: 6 }).success, false);
  assert.equal(MoveRollBody.safeParse({ pjId: "x", movimientoId: "golpe", opciones: { bonus: 1 } }).success, true);
  assert.equal(MoveRollBody.safeParse({ movimientoId: "golpe" }).success, false);
  // La hoja llega como objeto: la valida el sistema de la Partida, no el cuerpo de la API.
  assert.equal(CreatePjBody.safeParse({ sheet: { nombre: "Lía" } }).success, true);
  assert.equal(CreatePjBody.safeParse({ sheet: "texto" }).success, false);
  assert.equal(CreatePjBody.safeParse({ sheet: { nombre: "Lía" }, imagen: "../etc/passwd" }).success, false);
});


test("música: play/pause/seek calculan la posición con el reloj del servidor", () => {
  let m = reduceMusic(IDLE_MUSIC, { accion: "play", pistaId: "t1" }, 1_000);
  assert.deepEqual(m, { pistaId: "t1", reproduciendo: true, posicionMs: 0, actualizadoEn: 1_000 });
  assert.equal(musicPositionMs(m, 4_500), 3_500);
  m = reduceMusic(m, { accion: "pause" }, 4_500);
  assert.equal(m.posicionMs, 3_500);
  assert.equal(musicPositionMs(m, 99_999), 3_500); // en pausa no avanza
  m = reduceMusic(m, { accion: "play" }, 10_000); // reanuda donde estaba
  assert.equal(m.posicionMs, 3_500);
  assert.equal(musicPositionMs(m, 12_000), 5_500);
  m = reduceMusic(m, { accion: "seek", posicionMs: 60_000 }, 12_000);
  assert.equal(musicPositionMs(m, 13_000), 61_000);
  m = reduceMusic(m, { accion: "play", pistaId: "t2" }, 20_000); // otra pista empieza en 0
  assert.equal(m.posicionMs, 0);
  assert.equal(reduceMusic(IDLE_MUSIC, { accion: "play" }, 5).reproduciendo, false); // sin pista no hace nada
  m = reduceMusic(m, { accion: "stop" }, 30_000);
  assert.equal(m.pistaId, null);
});


test("chat: los susurros solo los ven autor y destinatario (los Narradores ajenos no)", () => {
  const ana: Actor = { id: "ana", rol: "jugador" };
  const beto: Actor = { id: "beto", rol: "jugador" };
  const gm: Actor = { id: "gm", rol: "narrador" };
  const publico = { autorId: "ana", destinatarioId: null };
  const susurroABeto = { autorId: "ana", destinatarioId: "beto" };
  for (const a of [ana, beto, gm]) assert.equal(canSeeMessage(a, publico), true);
  assert.equal(canSeeMessage(ana, susurroABeto), true);
  assert.equal(canSeeMessage(beto, susurroABeto), true);
  assert.equal(canSeeMessage(gm, susurroABeto), false);
  assert.equal(canSeeMessage(gm, { autorId: "ana", destinatarioId: "gm" }), true); // susurro al Narrador
  assert.equal(canSeeMessage(gm, { autorId: "gm", destinatarioId: "ana" }), true);
});
