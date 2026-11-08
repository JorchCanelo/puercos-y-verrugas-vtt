import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  RuleError,
  createRegistry,
  defineSystem,
  patchOf,
  type FichaDto,
  type MensajeDto,
  type MusicDto,
  type StateScope,
  type SystemRegistry,
  type TiradaDto,
} from "@pyv/shared";
import type { Ctx, Notifier, ServerActor } from "../src/ctx";
import { migrate, type Db } from "../src/db";
import * as svc from "../src/services";

// ---------------------------------------------------------------------------
// Sistema de juego de prueba: el núcleo no conoce reglas, así que las pruebas usan este (id "prueba").
// Hoja: nombre, puntos (0-10), dormido, trucos y un secreto que solo el Narrador puede poner al crear.
// Movimiento "golpe": 1d10 + puntos + bonus (0-2); 10+ = "bien". Progreso: aprender un truco. Catálogo: trucos.
// ---------------------------------------------------------------------------

export const TEST_SYSTEM_ID = "prueba";

export const TestSheetSchema = z.object({
  nombre: z.string().trim().min(1).max(80),
  puntos: z.number().int().min(0).max(10).default(5),
  dormido: z.boolean().default(false),
  trucos: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  secreto: z.string().max(200).default(""),
});
export type TestSheet = z.infer<typeof TestSheetSchema>;

export const testSystem = defineSystem<TestSheet>({
  id: TEST_SYSTEM_ID,
  nombre: "Sistema de prueba",
  version: "0.0.1",
  sheet: {
    schema: TestSheetSchema,
    patchSchema: patchOf(TestSheetSchema),
    empty: (nombre) => TestSheetSchema.parse({ nombre }),
    displayName: (s) => `★ ${s.nombre}`,
    playerSafeKeys: ["puntos", "dormido"],
    normalize: (s) => ({ ...s, trucos: [...new Set(s.trucos)] }),
    validateCreation: (s) => (s.secreto ? ["Los jugadores no eligen secreto"] : []),
  },
  canAct: (s) => !s.dormido,
  moves: {
    optionsSchema: z.object({ bonus: z.number().int().min(0).max(2).default(0) }),
    roll(sheet, movimientoId, opciones, ctx) {
      if (movimientoId !== "golpe") throw new RuleError("Solo hay golpe");
      const { bonus } = opciones as { bonus: number };
      const d = ctx.die(10);
      const total = d + sheet.puntos + bonus;
      const bien = total >= 10;
      return {
        movimientoId,
        movimientoNombre: "Golpe",
        detalle: null,
        stat: "puntos",
        statEtiqueta: "Puntos",
        caras: 10,
        dados: [d],
        modificador: sheet.puntos + bonus,
        total,
        resultado: bien ? "bien" : "mal",
        resultadoEtiqueta: bien ? "¡Bien!" : "Mal",
        resultadoTono: bien ? "exito" : "fallo",
      };
    },
  },
  progress: {
    choiceSchema: z.object({ truco: z.string().trim().min(1).max(80) }),
    apply(s, c) {
      if (s.puntos < 3) throw new RuleError("Se necesitan 3 puntos para aprender un truco");
      return { ...s, puntos: s.puntos - 3, trucos: [...s.trucos, (c as { truco: string }).truco] };
    },
  },
  catalog: {
    entrySchema: z.object({ truco: z.string().trim().min(1).max(80) }),
    key: (e) => (e as { truco: string }).truco.toLowerCase(),
    fromSheet: (s) => (s as TestSheet).trucos.map((truco) => ({ truco })),
  },
});

/** Hoja válida del sistema de prueba. */
export const testSheet = (over: Partial<TestSheet> = {}): TestSheet => TestSheetSchema.parse({ nombre: "Lía", ...over });

export interface Recorded {
  changed: { partidaId: string; scopes: StateScope[] }[];
  tiradas: TiradaDto[];
  mensajes: MensajeDto[];
  fichas: { f: FichaDto; soloNarradores: boolean }[];
  musica: MusicDto[];
  cerradas: string[];
  expulsados: string[];
}

/** Contexto de pruebas: SQLite en memoria (node:sqlite), reloj controlable y dados predecibles. */
export function makeCtx(systems: SystemRegistry = createRegistry([testSystem])) {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  const db = raw as unknown as Db;
  migrate(db);

  const rec: Recorded = { changed: [], tiradas: [], mensajes: [], fichas: [], musica: [], cerradas: [], expulsados: [] };
  const notify: Notifier = {
    changed: (partidaId, scopes) => rec.changed.push({ partidaId, scopes }),
    tirada: (_p, t) => rec.tiradas.push(t),
    mensaje: (_p, m) => rec.mensajes.push(m),
    ficha: (_p, f, soloNarradores) => rec.fichas.push({ f, soloNarradores }),
    musica: (_p, m) => rec.musica.push(m),
    partidaCerrada: (p) => rec.cerradas.push(p),
    usuarioExpulsado: (_p, u) => rec.expulsados.push(u),
  };

  const clock = { t: 1_700_000_000_000 };
  const dice: number[] = [];
  const ctx: Ctx = {
    db,
    notify,
    now: () => clock.t,
    die: (sides) => dice.shift() ?? Math.min(sides, 3),
    secret: Buffer.alloc(32, 7),
    dataDir: "/tmp/vtt-test",
    systems,
    connected: () => [],
  };
  return { ctx, rec, clock, dice };
}

/** Partida activa con: Narrador anfitrión, un segundo Narrador, y los jugadores Ana y Beto. */
export async function setup(ctx: Ctx, sistema = TEST_SYSTEM_ID) {
  const partida = svc.createPartida(ctx, { nombre: "Curso 1", descripcion: "", anfitrionNombre: "Narradora", sistema });
  svc.setActiva(ctx, partida.id, true);
  const host = ctx.db.prepare("SELECT * FROM usuarios WHERE partida_id = ? AND es_anfitrion = 1").get(partida.id) as Record<string, unknown>;
  const narrador: ServerActor = { id: String(host.id), rol: "narrador", partidaId: partida.id, nombre: "Narradora" };
  const mk = async (nombre: string, rol: "narrador" | "jugador"): Promise<ServerActor> => {
    const u = await svc.createUser(ctx, narrador, { nombre, password: "secreto1", rol });
    return { id: u.id, rol, partidaId: partida.id, nombre };
  };
  const ana = await mk("Ana", "jugador");
  const beto = await mk("Beto", "jugador");
  const segunda = await mk("Segunda", "narrador");
  return { partida, narrador, ana, beto, segunda };
}
