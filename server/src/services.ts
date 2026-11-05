// Lógica de negocio independiente de Fastify/Socket.IO: recibe un Ctx (db + notificador) y un actor.
// Los permisos se deciden aquí con las funciones puras de @pyv/shared.
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  DEFAULT_SYSTEM_ID,
  IDLE_MUSIC,
  RuleError,
  can,
  checkPjPatch,
  isNarrator,
  reduceMusic,
  rollDice,
  formatDiceExpr,
  sum,
  type CreateFichaBody,
  type CreatePartidaBody,
  type CreatePjBody,
  type CreateUserBody,
  type EscenaBody,
  type FichaDto,
  type ChatBody,
  type FreeRollBody,
  type GameSystem,
  type MaterialBody,
  type MaterialDto,
  type MoveRollBody,
  type MusicBody,
  type MusicDto,
  type NpcBody,
  type PartidaDto,
  type PatchEscenaBody,
  type PatchFichaBody,
  type PatchMaterialBody,
  type PatchNpcBody,
  type PatchPartidaBody,
  type PatchPjBody,
  type PistaDto,
  type PlaylistDto,
  type PjDto,
  type Resource,
  type SistemaInfoDto,
  type MensajeDto,
  type TiradaDto,
  type UsuarioDto,
  type Visibilidad,
  type EscenaDto,
  type NpcDto,
} from "@pyv/shared";
import { hashPassword, signSession, verifyPassword, verifySession, SESSION_TTL_MS, type HostTokens } from "./auth";
import type { Ctx, ServerActor } from "./ctx";
import { tx } from "./db";
import { conflict, forbidden, notFound, unauthorized, unprocessable } from "./errors";
import type { ZodError } from "zod";
import {
  escenaDto,
  fichasDto,
  getEscenaRow,
  getFichaRow,
  getMaterialRow,
  getMusic,
  getNpcRow,
  getPartidaRow,
  getPista,
  getPjRow,
  getUsuarioRow,
  materialDto,
  npcDto,
  partidaDto,
  pjDto,
  usuarioDto,
} from "./repo";

type Body<T extends z.ZodTypeAny> = z.infer<T>;
type Row = Record<string, unknown>;

const uid = () => randomUUID();
const bool = (v: unknown) => Number(v) === 1;
const int = (b: boolean) => (b ? 1 : 0);

export function requireNarrator(actor: ServerActor): void {
  if (!isNarrator(actor)) throw forbidden("Solo el Narrador puede hacer esto");
}

const isUnique = (e: unknown) => e instanceof Error && /UNIQUE/i.test(e.message);

// ===========================================================================
// Partidas (las usa el listener local del anfitrión)
// ===========================================================================

export function listPartidas(ctx: Ctx): PartidaDto[] {
  return ctx.db.prepare("SELECT * FROM partidas ORDER BY creada_en").all().map((r) => partidaDto(r, ctx.systems));
}

/** Sistemas de juego instalados (para elegir al crear una Partida). El genérico va primero. */
export function listSistemas(ctx: Ctx): SistemaInfoDto[] {
  return ctx.systems
    .list()
    .map(({ id, nombre, version }) => ({ id, nombre, version }))
    .sort((a, b) => (a.id === DEFAULT_SYSTEM_ID ? -1 : b.id === DEFAULT_SYSTEM_ID ? 1 : a.nombre.localeCompare(b.nombre, "es")));
}

function assertInstalled(ctx: Ctx, sistema: string): void {
  if (!ctx.systems.get(sistema)) throw unprocessable(`El sistema de juego "${sistema}" no está instalado`);
}

/** Lo único que ve alguien sin sesión: las Partidas abiertas (para elegir a cuál entrar). */
export function listPartidasActivas(ctx: Ctx): Pick<PartidaDto, "id" | "nombre" | "descripcion" | "imagen">[] {
  return listPartidas(ctx)
    .filter((p) => p.activa)
    .map(({ id, nombre, descripcion, imagen }) => ({ id, nombre, descripcion, imagen }));
}

export function createPartida(ctx: Ctx, body: Body<typeof CreatePartidaBody>): PartidaDto {
  const id = uid();
  const sistema = body.sistema ?? DEFAULT_SYSTEM_ID;
  assertInstalled(ctx, sistema);
  tx(ctx.db, () => {
    ctx.db
      .prepare("INSERT INTO partidas (id, nombre, descripcion, sistema, musica, creada_en) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, body.nombre, body.descripcion, sistema, JSON.stringify({ ...IDLE_MUSIC, actualizadoEn: ctx.now() }), ctx.now());
    // El anfitrión siempre tiene su Narrador, sin contraseña (solo entra por token del listener local).
    ctx.db
      .prepare("INSERT INTO usuarios (id, partida_id, nombre, password_hash, rol, es_anfitrion) VALUES (?, ?, ?, NULL, 'narrador', 1)")
      .run(uid(), id, body.anfitrionNombre);
  });
  return partidaDto(getPartidaRow(ctx.db, id), ctx.systems);
}

export function patchPartida(ctx: Ctx, id: string, body: Body<typeof PatchPartidaBody>): PartidaDto {
  const current = getPartidaRow(ctx.db, id);
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (body.nombre !== undefined) (sets.push("nombre = ?"), vals.push(body.nombre));
  if (body.descripcion !== undefined) (sets.push("descripcion = ?"), vals.push(body.descripcion));
  if (body.imagen !== undefined) (sets.push("imagen = ?"), vals.push(body.imagen));
  if (body.edicionLibreDefault !== undefined) (sets.push("edicion_libre_default = ?"), vals.push(int(body.edicionLibreDefault)));
  if (body.sistema !== undefined && body.sistema !== current.sistema) {
    assertInstalled(ctx, body.sistema);
    const pjs = Number((ctx.db.prepare("SELECT COUNT(*) AS n FROM pjs WHERE partida_id = ?").get(id) as { n: number }).n);
    if (pjs > 0) throw conflict("No se puede cambiar el sistema de juego de una Partida que ya tiene personajes");
    sets.push("sistema = ?");
    vals.push(body.sistema);
  }
  if (sets.length) ctx.db.prepare(`UPDATE partidas SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  ctx.notify.changed(id, body.sistema !== undefined ? ["partida", "pjs", "catalogo"] : ["partida"]);
  return partidaDto(getPartidaRow(ctx.db, id), ctx.systems);
}

export function setActiva(ctx: Ctx, id: string, activa: boolean): PartidaDto {
  getPartidaRow(ctx.db, id);
  ctx.db.prepare("UPDATE partidas SET activa = ? WHERE id = ?").run(int(activa), id);
  if (!activa) ctx.notify.partidaCerrada(id);
  return partidaDto(getPartidaRow(ctx.db, id), ctx.systems);
}

export function deletePartida(ctx: Ctx, id: string): void {
  getPartidaRow(ctx.db, id);
  ctx.notify.partidaCerrada(id);
  ctx.db.prepare("DELETE FROM partidas WHERE id = ?").run(id); // ON DELETE CASCADE limpia todo lo demás
}

// ===========================================================================
// Autenticación
// ===========================================================================

export function issueSession(ctx: Ctx, user: Row): { token: string; usuario: UsuarioDto } {
  const token = signSession(ctx.secret, { u: String(user.id), p: String(user.partida_id), e: ctx.now() + SESSION_TTL_MS });
  return { token, usuario: usuarioDto(user) };
}

export async function login(ctx: Ctx, body: { partidaId: string; nombre: string; password: string }) {
  const partida = ctx.db.prepare("SELECT * FROM partidas WHERE id = ?").get(body.partidaId);
  const user =
    partida && bool(partida.activa)
      ? ctx.db.prepare("SELECT * FROM usuarios WHERE partida_id = ? AND nombre = ? COLLATE NOCASE").get(body.partidaId, body.nombre)
      : undefined;
  // El Narrador anfitrión tiene password_hash NULL: verifyPassword siempre falla para él → no se puede entrar por aquí.
  const ok = await verifyPassword(body.password, (user?.password_hash as string | null | undefined) ?? null);
  if (!partida || !user || !ok) throw unauthorized("Usuario o contraseña incorrectos");
  return issueSession(ctx, user);
}

/** Canjea un token del anfitrión (emitido solo por el listener local) por una sesión de su Narrador. */
export function exchangeHostToken(ctx: Ctx, hostTokens: HostTokens, token: string) {
  const partidaId = hostTokens.consume(token);
  const partida = partidaId ? ctx.db.prepare("SELECT * FROM partidas WHERE id = ?").get(partidaId) : undefined;
  if (!partidaId || !partida || !bool(partida.activa)) throw unauthorized("Token inválido o caducado");
  const host = ctx.db.prepare("SELECT * FROM usuarios WHERE partida_id = ? AND es_anfitrion = 1").get(partidaId);
  if (!host) throw unauthorized("Token inválido o caducado");
  return issueSession(ctx, host);
}

/** Resuelve el actor a partir de una cookie de sesión (REST y sockets). Null si no es válida o la Partida está cerrada. */
export function authenticate(ctx: Ctx, token: string | undefined): ServerActor | null {
  const p = verifySession(ctx.secret, token, ctx.now());
  if (!p) return null;
  const row = ctx.db
    .prepare("SELECT u.*, pa.activa AS partida_activa FROM usuarios u JOIN partidas pa ON pa.id = u.partida_id WHERE u.id = ? AND u.partida_id = ?")
    .get(p.u, p.p);
  if (!row || !bool(row.partida_activa)) return null;
  return { id: String(row.id), rol: row.rol as ServerActor["rol"], partidaId: String(row.partida_id), nombre: String(row.nombre) };
}

// ===========================================================================
// Usuarios
// ===========================================================================

export async function createUser(ctx: Ctx, actor: ServerActor, body: Body<typeof CreateUserBody>): Promise<UsuarioDto> {
  requireNarrator(actor);
  const hash = await hashPassword(body.password);
  const id = uid();
  try {
    ctx.db
      .prepare("INSERT INTO usuarios (id, partida_id, nombre, password_hash, rol, es_anfitrion) VALUES (?, ?, ?, ?, ?, 0)")
      .run(id, actor.partidaId, body.nombre, hash, body.rol);
  } catch (e) {
    if (isUnique(e)) throw conflict("Ya existe un usuario con ese nombre");
    throw e;
  }
  ctx.notify.changed(actor.partidaId, ["usuarios"]);
  return usuarioDto(getUsuarioRow(ctx.db, actor.partidaId, id));
}

export function deleteUser(ctx: Ctx, actor: ServerActor, userId: string): void {
  requireNarrator(actor);
  const u = getUsuarioRow(ctx.db, actor.partidaId, userId);
  if (bool(u.es_anfitrion)) throw forbidden("No se puede eliminar al Narrador anfitrión");
  if (userId === actor.id) throw forbidden("No puedes eliminarte a ti mismo");
  ctx.db.prepare("DELETE FROM usuarios WHERE id = ?").run(userId); // sus PJs quedan sin dueño (ON DELETE SET NULL)
  ctx.notify.changed(actor.partidaId, ["usuarios", "pjs"]);
}

// ===========================================================================
// Personajes (PJ)
// ===========================================================================

// --- sistema de juego de la Partida ------------------------------------------------

/** Sistema de la Partida (undefined si no está instalado en este VTT). */
export function systemOf(ctx: Ctx, partidaId: string): { id: string; system: GameSystem<any> | undefined } {
  const id = String(getPartidaRow(ctx.db, partidaId).sistema);
  return { id, system: ctx.systems.get(id) };
}

/** Sistema de la Partida o 409: sin él, las hojas quedan en solo lectura (no se toca su JSON). */
function requireSystem(ctx: Ctx, partidaId: string): GameSystem<any> {
  const { id, system } = systemOf(ctx, partidaId);
  if (!system) throw conflict(`El sistema de juego "${id}" no está instalado: los personajes de esta Partida están en solo lectura`);
  return system;
}

const zodMessage = (e: ZodError) => e.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");

/** La hoja guardada, con los defaults del sistema aplicados (hojas antiguas). Si no encaja, tal cual. */
function readSheet(system: GameSystem<any>, raw: unknown): unknown {
  const r = system.sheet.schema.safeParse(raw);
  return r.success ? r.data : raw;
}

const pjOf = (ctx: Ctx, partidaId: string, pjId: string, system: GameSystem<any> | undefined) => pjDto(getPjRow(ctx.db, partidaId, pjId), system);

/** Lo que aparece en una hoja alimenta el catálogo de la Partida (autocompletado). Devuelve si añadió algo. */
function syncCatalog(ctx: Ctx, partidaId: string, system: GameSystem<any>, sheet: unknown): boolean {
  const catalog = system.catalog;
  if (!catalog) return false;
  let added = false;
  for (const entry of catalog.fromSheet(sheet)) if (insertCatalog(ctx, partidaId, system, entry)) added = true;
  return added;
}

function insertCatalog(ctx: Ctx, partidaId: string, system: GameSystem<any>, entry: unknown): boolean {
  const r = ctx.db
    .prepare("INSERT OR IGNORE INTO catalogo (id, partida_id, sistema, clave, data) VALUES (?, ?, ?, ?, ?)")
    .run(uid(), partidaId, system.id, system.catalog!.key(entry), JSON.stringify(entry));
  return Number(r.changes) > 0;
}

function assertUserInPartida(ctx: Ctx, partidaId: string, userId: string | null | undefined): void {
  if (userId) {
    const u = ctx.db.prepare("SELECT 1 AS ok FROM usuarios WHERE id = ? AND partida_id = ?").get(userId, partidaId);
    if (!u) throw unprocessable("El dueño indicado no pertenece a la Partida");
  }
}

export function createPj(ctx: Ctx, actor: ServerActor, body: Body<typeof CreatePjBody>): PjDto {
  const system = requireSystem(ctx, actor.partidaId);
  const partida = getPartidaRow(ctx.db, actor.partidaId);
  const parsed = system.sheet.schema.safeParse(body.sheet);
  if (!parsed.success) throw unprocessable(zodMessage(parsed.error));
  let ownerId: string | null;
  if (isNarrator(actor)) {
    ownerId = body.duenoId === undefined ? actor.id : body.duenoId;
    assertUserInPartida(ctx, actor.partidaId, ownerId);
  } else {
    // Los jugadores crean PJs solo para sí mismos y siguiendo las reglas de creación del sistema.
    if (body.duenoId !== undefined && body.duenoId !== actor.id) throw forbidden("No puedes asignar la pertenencia");
    ownerId = actor.id;
    const errors = system.sheet.validateCreation?.(parsed.data) ?? [];
    if (errors.length) throw unprocessable(errors.join(". "));
  }
  const sheet = system.sheet.normalize ? system.sheet.normalize(parsed.data, uid) : parsed.data;
  const id = uid();
  ctx.db
    .prepare("INSERT INTO pjs (id, partida_id, dueno_id, imagen, edicion_libre, sheet) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, actor.partidaId, ownerId, body.imagen ?? null, partida.edicion_libre_default, JSON.stringify(sheet));
  const added = syncCatalog(ctx, actor.partidaId, system, sheet);
  ctx.notify.changed(actor.partidaId, added ? ["pjs", "catalogo"] : ["pjs"]);
  return pjOf(ctx, actor.partidaId, id, system);
}

export function patchPj(ctx: Ctx, actor: ServerActor, pjId: string, body: Body<typeof PatchPjBody>): PjDto {
  const { system } = systemOf(ctx, actor.partidaId);
  const current = pjOf(ctx, actor.partidaId, pjId, system);
  if (!can(actor, "view", { kind: "pj", ownerId: current.duenoId, edicionLibre: current.edicionLibre }))
    throw notFound("Personaje no encontrado"); // un jugador no debe saber que existe el PJ de otro
  const sys = requireSystem(ctx, actor.partidaId);

  const patchParsed = sys.sheet.patchSchema.safeParse(body.sheet ?? {});
  if (!patchParsed.success) throw unprocessable(zodMessage(patchParsed.error));
  const patchSheet = patchParsed.data as Record<string, unknown>;
  const err = checkPjPatch(
    actor,
    { ownerId: current.duenoId, edicionLibre: current.edicionLibre },
    {
      sheetKeys: Object.keys(patchSheet).filter((k) => patchSheet[k] !== undefined),
      imagen: body.imagen !== undefined,
      duenoId: body.duenoId !== undefined,
      edicionLibre: body.edicionLibre !== undefined,
    },
    sys.sheet.playerSafeKeys,
  );
  if (err) throw forbidden(err);
  if (body.duenoId !== undefined) assertUserInPartida(ctx, actor.partidaId, body.duenoId);

  const definedPatch = Object.fromEntries(Object.entries(patchSheet).filter(([, v]) => v !== undefined));
  const merged = sys.sheet.schema.safeParse({ ...(current.sheet as object), ...definedPatch });
  if (!merged.success) throw unprocessable(zodMessage(merged.error));
  const sheet = sys.sheet.normalize ? sys.sheet.normalize(merged.data, uid) : merged.data;

  ctx.db
    .prepare("UPDATE pjs SET sheet = ?, imagen = ?, dueno_id = ?, edicion_libre = ? WHERE id = ?")
    .run(
      JSON.stringify(sheet),
      body.imagen !== undefined ? body.imagen : current.imagen,
      body.duenoId !== undefined ? body.duenoId : current.duenoId,
      int(body.edicionLibre ?? current.edicionLibre),
      pjId,
    );
  const added = syncCatalog(ctx, actor.partidaId, sys, sheet);
  ctx.notify.changed(actor.partidaId, added ? ["pjs", "fichas", "catalogo"] : ["pjs", "fichas"]);
  return pjOf(ctx, actor.partidaId, pjId, sys);
}

/** Aplica un progreso del sistema. Lo puede hacer el dueño (aunque no tenga edición libre) o un Narrador. */
export function progressPj(ctx: Ctx, actor: ServerActor, pjId: string, rawChoice: unknown): PjDto {
  const { system } = systemOf(ctx, actor.partidaId);
  const current = pjOf(ctx, actor.partidaId, pjId, system);
  if (!can(actor, "edit", { kind: "pj", ownerId: current.duenoId, edicionLibre: current.edicionLibre }))
    throw notFound("Personaje no encontrado");
  const sys = requireSystem(ctx, actor.partidaId);
  if (!sys.progress) throw unprocessable("Este sistema de juego no tiene progreso");
  const choice = sys.progress.choiceSchema.safeParse(rawChoice);
  if (!choice.success) throw unprocessable(zodMessage(choice.error));
  let next: unknown;
  try {
    next = sys.progress.apply(readSheet(sys, current.sheet), choice.data);
  } catch (e) {
    if (e instanceof RuleError) throw unprocessable(e.message);
    throw e;
  }
  const checked = sys.sheet.schema.safeParse(next);
  if (!checked.success) throw unprocessable(zodMessage(checked.error));
  const sheet = sys.sheet.normalize ? sys.sheet.normalize(checked.data, uid) : checked.data;
  ctx.db.prepare("UPDATE pjs SET sheet = ? WHERE id = ?").run(JSON.stringify(sheet), pjId);
  const added = syncCatalog(ctx, actor.partidaId, sys, sheet);
  ctx.notify.changed(actor.partidaId, added ? ["pjs", "catalogo"] : ["pjs"]);
  return pjOf(ctx, actor.partidaId, pjId, sys);
}

export function deletePj(ctx: Ctx, actor: ServerActor, pjId: string): void {
  requireNarrator(actor);
  getPjRow(ctx.db, actor.partidaId, pjId);
  requireSystem(ctx, actor.partidaId); // solo lectura si el sistema no está instalado
  tx(ctx.db, () => {
    ctx.db.prepare("DELETE FROM fichas WHERE ref_tipo = 'pj' AND ref_id = ?").run(pjId);
    ctx.db.prepare("DELETE FROM pjs WHERE id = ?").run(pjId);
  });
  ctx.notify.changed(actor.partidaId, ["pjs", "fichas"]);
}

// ===========================================================================
// NPCs
// ===========================================================================

export function createNpc(ctx: Ctx, actor: ServerActor, body: Body<typeof NpcBody>): NpcDto {
  requireNarrator(actor);
  const id = uid();
  ctx.db
    .prepare("INSERT INTO npcs (id, partida_id, nombre, imagen, notas, oculto) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, actor.partidaId, body.nombre, body.imagen ?? null, body.notas, int(body.oculto));
  ctx.notify.changed(actor.partidaId, ["npcs"]);
  return npcDto(getNpcRow(ctx.db, actor.partidaId, id));
}

export function patchNpc(ctx: Ctx, actor: ServerActor, npcId: string, body: Body<typeof PatchNpcBody>): NpcDto {
  requireNarrator(actor);
  const cur = npcDto(getNpcRow(ctx.db, actor.partidaId, npcId));
  ctx.db
    .prepare("UPDATE npcs SET nombre = ?, imagen = ?, notas = ?, oculto = ? WHERE id = ?")
    .run(body.nombre ?? cur.nombre, body.imagen !== undefined ? body.imagen : cur.imagen, body.notas ?? cur.notas, int(body.oculto ?? cur.oculto), npcId);
  ctx.notify.changed(actor.partidaId, ["npcs", "fichas"]);
  return npcDto(getNpcRow(ctx.db, actor.partidaId, npcId));
}

export function deleteNpc(ctx: Ctx, actor: ServerActor, npcId: string): void {
  requireNarrator(actor);
  getNpcRow(ctx.db, actor.partidaId, npcId);
  tx(ctx.db, () => {
    ctx.db.prepare("DELETE FROM fichas WHERE ref_tipo = 'npc' AND ref_id = ?").run(npcId);
    ctx.db.prepare("DELETE FROM npcs WHERE id = ?").run(npcId);
  });
  ctx.notify.changed(actor.partidaId, ["npcs", "fichas"]);
}

// ===========================================================================
// Escenas y fichas
// ===========================================================================

export function createEscena(ctx: Ctx, actor: ServerActor, body: Body<typeof EscenaBody>): EscenaDto {
  requireNarrator(actor);
  const id = uid();
  const orden = Number((ctx.db.prepare("SELECT COALESCE(MAX(orden), -1) + 1 AS o FROM escenas WHERE partida_id = ?").get(actor.partidaId) as Row).o);
  ctx.db
    .prepare("INSERT INTO escenas (id, partida_id, nombre, tipo, imagen, filas, columnas, abierta, orden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, actor.partidaId, body.nombre, body.tipo, body.imagen ?? null, body.filas, body.columnas, int(body.abierta), orden);
  ctx.notify.changed(actor.partidaId, ["escenas"]);
  return escenaDto(getEscenaRow(ctx.db, actor.partidaId, id));
}

export function patchEscena(ctx: Ctx, actor: ServerActor, escenaId: string, body: Body<typeof PatchEscenaBody>): EscenaDto {
  requireNarrator(actor);
  const cur = escenaDto(getEscenaRow(ctx.db, actor.partidaId, escenaId));
  const fichas = ctx.db.prepare("SELECT * FROM fichas WHERE escena_id = ?").all(escenaId);
  const tipo = body.tipo ?? cur.tipo;
  const filas = body.filas ?? cur.filas;
  const columnas = body.columnas ?? cur.columnas;
  if (tipo !== cur.tipo && fichas.length) throw conflict("Quita las fichas antes de cambiar el tipo de escena");
  if (tipo === "cuadricula" && fichas.some((f) => Number(f.x) >= columnas || Number(f.y) >= filas))
    throw conflict("Hay fichas fuera de la nueva cuadrícula");
  ctx.db
    .prepare("UPDATE escenas SET nombre = ?, tipo = ?, imagen = ?, filas = ?, columnas = ?, abierta = ?, orden = ? WHERE id = ?")
    .run(
      body.nombre ?? cur.nombre,
      tipo,
      body.imagen !== undefined ? body.imagen : cur.imagen,
      filas,
      columnas,
      int(body.abierta ?? cur.abierta),
      body.orden ?? cur.orden,
      escenaId,
    );
  ctx.notify.changed(actor.partidaId, ["escenas"]);
  return escenaDto(getEscenaRow(ctx.db, actor.partidaId, escenaId));
}

export function deleteEscena(ctx: Ctx, actor: ServerActor, escenaId: string): void {
  requireNarrator(actor);
  getEscenaRow(ctx.db, actor.partidaId, escenaId);
  tx(ctx.db, () => {
    ctx.db.prepare("UPDATE partidas SET escena_proyectada_id = NULL WHERE id = ? AND escena_proyectada_id = ?").run(actor.partidaId, escenaId);
    ctx.db.prepare("DELETE FROM escenas WHERE id = ?").run(escenaId); // las fichas caen en cascada
  });
  ctx.notify.changed(actor.partidaId, ["escenas", "fichas", "partida"]);
}

/** Proyecta una escena a todos los jugadores (o `null` para apagar el tablero). */
export function proyectarEscena(ctx: Ctx, actor: ServerActor, escenaId: string | null): void {
  requireNarrator(actor);
  if (escenaId) getEscenaRow(ctx.db, actor.partidaId, escenaId);
  ctx.db.prepare("UPDATE partidas SET escena_proyectada_id = ? WHERE id = ?").run(escenaId, actor.partidaId);
  ctx.notify.changed(actor.partidaId, ["escenas", "fichas", "partida"]);
}

/** Escena libre: coordenadas 0..1. Cuadrícula: casillas enteras dentro de los límites y sin otra ficha. */
function checkPosition(ctx: Ctx, escena: Row, x: number, y: number, excludeFichaId?: string): void {
  if (escena.tipo === "cuadricula") {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= Number(escena.columnas) || y >= Number(escena.filas))
      throw unprocessable("Posición fuera de la cuadrícula");
    const taken = ctx.db
      .prepare("SELECT id FROM fichas WHERE escena_id = ? AND x = ? AND y = ? AND id != ?")
      .get(escena.id, x, y, excludeFichaId ?? "");
    if (taken) throw conflict("Esa casilla ya está ocupada");
  } else if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) {
    throw unprocessable("Posición fuera de la escena (usa coordenadas de 0 a 1)");
  }
}

/** Un NPC oculto también oculta sus fichas a los jugadores. */
function isHiddenFromPlayers(ctx: Ctx, f: Row): boolean {
  if (bool(f.oculta)) return true;
  if (f.ref_tipo !== "npc") return false;
  const npc = ctx.db.prepare("SELECT oculto FROM npcs WHERE id = ?").get(f.ref_id);
  return !npc || bool(npc.oculto);
}

export function createFicha(ctx: Ctx, actor: ServerActor, escenaId: string, body: Body<typeof CreateFichaBody>): FichaDto {
  requireNarrator(actor);
  const escena = getEscenaRow(ctx.db, actor.partidaId, escenaId);
  if (body.ref.tipo === "pj") getPjRow(ctx.db, actor.partidaId, body.ref.id);
  else getNpcRow(ctx.db, actor.partidaId, body.ref.id);
  const dup = ctx.db.prepare("SELECT 1 AS ok FROM fichas WHERE escena_id = ? AND ref_tipo = ? AND ref_id = ?").get(escenaId, body.ref.tipo, body.ref.id);
  if (dup) throw conflict("Ese personaje ya tiene una ficha en esta escena");
  checkPosition(ctx, escena, body.x, body.y);
  const id = uid();
  ctx.db
    .prepare("INSERT INTO fichas (id, escena_id, partida_id, ref_tipo, ref_id, x, y, oculta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, escenaId, actor.partidaId, body.ref.tipo, body.ref.id, body.x, body.y, int(body.oculta));
  ctx.notify.changed(actor.partidaId, ["fichas"]);
  return fichasDto(ctx.db, actor.partidaId, [getFichaRow(ctx.db, actor.partidaId, id)], systemOf(ctx, actor.partidaId).system)[0] as FichaDto;
}

export function moveFicha(ctx: Ctx, actor: ServerActor, fichaId: string, body: Body<typeof PatchFichaBody>): FichaDto {
  const row = getFichaRow(ctx.db, actor.partidaId, fichaId);
  const escena = getEscenaRow(ctx.db, actor.partidaId, String(row.escena_id));
  const partida = getPartidaRow(ctx.db, actor.partidaId);
  const pjOwnerId = row.ref_tipo === "pj" ? ((getPjRow(ctx.db, actor.partidaId, String(row.ref_id)).dueno_id as string | null) ?? null) : null;
  const res: Resource = { kind: "ficha", pjOwnerId, oculta: isHiddenFromPlayers(ctx, row), proyectada: partida.escena_proyectada_id === escena.id };
  if (!can(actor, "move", res)) throw forbidden("No puedes mover esa ficha");
  if (body.oculta !== undefined && !isNarrator(actor)) throw forbidden("Solo el Narrador puede ocultar fichas");

  const x = body.x ?? Number(row.x);
  const y = body.y ?? Number(row.y);
  if (body.x !== undefined || body.y !== undefined) checkPosition(ctx, escena, x, y, fichaId);
  const oculta = body.oculta ?? bool(row.oculta);
  ctx.db.prepare("UPDATE fichas SET x = ?, y = ?, oculta = ? WHERE id = ?").run(x, y, int(oculta), fichaId);

  const updated = getFichaRow(ctx.db, actor.partidaId, fichaId);
  const dto = fichasDto(ctx.db, actor.partidaId, [updated], systemOf(ctx, actor.partidaId).system)[0] as FichaDto;
  if (oculta !== bool(row.oculta)) ctx.notify.changed(actor.partidaId, ["fichas"]); // aparece/desaparece para los jugadores
  else ctx.notify.ficha(actor.partidaId, dto, isHiddenFromPlayers(ctx, updated));
  return dto;
}

export function deleteFicha(ctx: Ctx, actor: ServerActor, fichaId: string): void {
  requireNarrator(actor);
  getFichaRow(ctx.db, actor.partidaId, fichaId);
  ctx.db.prepare("DELETE FROM fichas WHERE id = ?").run(fichaId);
  ctx.notify.changed(actor.partidaId, ["fichas"]);
}

// ===========================================================================
// Tiradas (siempre se resuelven en el servidor)
// ===========================================================================

function visibilidadFor(actor: ServerActor, privada: boolean): Visibilidad {
  if (!privada) return "publica";
  return isNarrator(actor) ? "narradores" : "autor_narradores";
}

function saveTirada(ctx: Ctx, actor: ServerActor, t: Omit<TiradaDto, "id" | "creadaEn" | "autorId" | "autorNombre">): TiradaDto {
  const full: TiradaDto = { ...t, id: uid(), creadaEn: ctx.now(), autorId: actor.id, autorNombre: actor.nombre };
  ctx.db
    .prepare("INSERT INTO tiradas (id, partida_id, autor_id, visibilidad, creada_en, data) VALUES (?, ?, ?, ?, ?, ?)")
    .run(full.id, actor.partidaId, actor.id, full.visibilidad, full.creadaEn, JSON.stringify(full));
  ctx.notify.tirada(actor.partidaId, full);
  return full;
}

export function rollMovement(ctx: Ctx, actor: ServerActor, body: Body<typeof MoveRollBody>): TiradaDto {
  const { system } = systemOf(ctx, actor.partidaId);
  const pj = pjOf(ctx, actor.partidaId, body.pjId, system);
  if (!isNarrator(actor) && pj.duenoId !== actor.id) throw forbidden("No es tu personaje");
  const sys = requireSystem(ctx, actor.partidaId);
  if (!sys.moves) throw unprocessable("Este sistema de juego no tiene movimientos: usa los dados libres");
  const sheet = readSheet(sys, pj.sheet);
  if (!isNarrator(actor) && sys.canAct && !sys.canAct(sheet)) throw conflict(`${pj.nombre} está inconsciente y no puede actuar`);
  const opciones = sys.moves.optionsSchema.safeParse(body.opciones ?? {});
  if (!opciones.success) throw unprocessable(zodMessage(opciones.error));

  let r;
  try {
    r = sys.moves.roll(sheet, body.movimientoId, opciones.data, { die: ctx.die, narrador: isNarrator(actor) });
  } catch (e) {
    if (e instanceof RuleError) throw unprocessable(e.message);
    throw e;
  }
  return saveTirada(ctx, actor, {
    pjId: pj.id,
    pjNombre: pj.nombre,
    tipo: "movimiento",
    movimientoId: r.movimientoId,
    movimientoNombre: r.movimientoNombre,
    detalle: r.detalle,
    stat: r.stat,
    statEtiqueta: r.statEtiqueta,
    caras: r.caras,
    dados: r.dados,
    modificador: r.modificador,
    total: r.total,
    resultado: r.resultado,
    resultadoEtiqueta: r.resultadoEtiqueta,
    resultadoTono: r.resultadoTono,
    visibilidad: visibilidadFor(actor, body.privada),
  });
}

/** Tirada libre de n dados de cualquier tipo + modificador. La puede hacer cualquier usuario (Narrador o Jugador). */
export function rollFree(ctx: Ctx, actor: ServerActor, body: Body<typeof FreeRollBody>): TiradaDto {
  const modificador = body.modificador ?? 0;
  const dados = rollDice(body.cantidad, body.caras, ctx.die);
  return saveTirada(ctx, actor, {
    pjId: null,
    pjNombre: null,
    tipo: "libre",
    movimientoId: null,
    movimientoNombre: null,
    detalle: formatDiceExpr({ cantidad: body.cantidad, caras: body.caras, modificador }),
    stat: null,
    caras: body.caras,
    dados,
    modificador,
    total: sum(dados) + modificador,
    resultado: null,
    visibilidad: visibilidadFor(actor, body.privada),
  });
}

// ===========================================================================
// Chat y registro
// ===========================================================================

/** Mensaje público o susurro (a una sola persona). Se puede hablar como un PJ propio (cualquiera, si eres Narrador). */
export function sendMessage(ctx: Ctx, actor: ServerActor, body: Body<typeof ChatBody>): MensajeDto {
  const texto = body.texto.trim();
  if (!texto) throw unprocessable("El mensaje está vacío");
  let remitenteNombre = actor.nombre;
  let pjId: string | null = null;
  if (body.pjId) {
    const pj = pjOf(ctx, actor.partidaId, body.pjId, systemOf(ctx, actor.partidaId).system);
    if (!isNarrator(actor) && pj.duenoId !== actor.id) throw forbidden("No es tu personaje");
    pjId = pj.id;
    remitenteNombre = pj.nombre;
  }
  let destinatarioId: string | null = null;
  let destinatarioNombre: string | null = null;
  if (body.destinatarioId) {
    if (body.destinatarioId === actor.id) throw unprocessable("No puedes susurrarte a ti mismo");
    const dest = ctx.db.prepare("SELECT id, nombre FROM usuarios WHERE id = ? AND partida_id = ?").get(body.destinatarioId, actor.partidaId);
    if (!dest) throw unprocessable("El destinatario no pertenece a la Partida");
    destinatarioId = String(dest.id);
    destinatarioNombre = String(dest.nombre);
  }
  const msg: MensajeDto = {
    id: uid(),
    autorId: actor.id,
    autorNombre: actor.nombre,
    remitenteNombre,
    pjId,
    destinatarioId,
    destinatarioNombre,
    texto,
    creadaEn: ctx.now(),
  };
  ctx.db
    .prepare("INSERT INTO mensajes (id, partida_id, autor_id, destinatario_id, creada_en, data) VALUES (?, ?, ?, ?, ?, ?)")
    .run(msg.id, actor.partidaId, msg.autorId, destinatarioId, msg.creadaEn, JSON.stringify(msg));
  ctx.notify.mensaje(actor.partidaId, msg);
  return msg;
}

/** Solo el Narrador: borra tiradas y chat (incluidos los susurros) para todos. */
export function clearLog(ctx: Ctx, actor: ServerActor): { ok: true } {
  requireNarrator(actor);
  tx(ctx.db, () => {
    ctx.db.prepare("DELETE FROM tiradas WHERE partida_id = ?").run(actor.partidaId);
    ctx.db.prepare("DELETE FROM mensajes WHERE partida_id = ?").run(actor.partidaId);
  });
  ctx.notify.changed(actor.partidaId, ["tiradas", "chat"]);
  return { ok: true };
}

// ===========================================================================
// Catálogo de la Partida (lo define el sistema; p. ej. hechizos)
// ===========================================================================

export function addCatalogEntry(ctx: Ctx, actor: ServerActor, body: unknown): { ok: true } {
  const sys = requireSystem(ctx, actor.partidaId);
  if (!sys.catalog) throw unprocessable("Este sistema de juego no tiene catálogo");
  const entry = sys.catalog.entrySchema.safeParse(body);
  if (!entry.success) throw unprocessable(zodMessage(entry.error));
  if (insertCatalog(ctx, actor.partidaId, sys, entry.data)) ctx.notify.changed(actor.partidaId, ["catalogo"]);
  return { ok: true };
}

// ===========================================================================
// Materiales
// ===========================================================================

export const materialResource = (m: MaterialDto): Resource => ({
  kind: "material",
  tipo: m.tipo,
  creadorId: m.creadorId,
  seccion: m.seccion,
  visibleATodos: m.visibleATodos,
  acceso: m.acceso,
});

function cleanAcceso(ctx: Ctx, partidaId: string, creatorId: string, acceso: MaterialDto["acceso"]): MaterialDto["acceso"] {
  const members = new Set(ctx.db.prepare("SELECT id FROM usuarios WHERE partida_id = ?").all(partidaId).map((r) => String(r.id)));
  const out = new Map<string, MaterialDto["acceso"][number]>();
  for (const a of acceso) {
    if (!members.has(a.usuarioId)) throw unprocessable("Un usuario asignado no pertenece a la Partida");
    if (a.usuarioId !== creatorId) out.set(a.usuarioId, a);
  }
  return [...out.values()];
}

export function createMaterial(ctx: Ctx, actor: ServerActor, body: Body<typeof MaterialBody>): MaterialDto {
  const visibleATodos = body.visibleATodos ?? body.seccion === "grupo";
  const acceso = cleanAcceso(ctx, actor.partidaId, actor.id, body.acceso);
  if (!can(actor, "create", { kind: "material", tipo: body.tipo, creadorId: actor.id, seccion: body.seccion, visibleATodos, acceso }))
    throw forbidden("Los jugadores solo pueden subir a «Notas de grupo»");
  if (body.tipo !== "nota" && !body.archivo) throw unprocessable("Falta el archivo");
  const id = uid();
  ctx.db
    .prepare("INSERT INTO materiales (id, partida_id, tipo, titulo, contenido, archivo, creador_id, seccion, visible_a_todos, acceso) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, actor.partidaId, body.tipo, body.titulo, body.tipo === "nota" ? body.contenido : "", body.archivo ?? null, actor.id, body.seccion, int(visibleATodos), JSON.stringify(acceso));
  ctx.notify.changed(actor.partidaId, ["materiales"]);
  return materialDto(getMaterialRow(ctx.db, actor.partidaId, id));
}

export function patchMaterial(ctx: Ctx, actor: ServerActor, id: string, body: Body<typeof PatchMaterialBody>): MaterialDto {
  const cur = materialDto(getMaterialRow(ctx.db, actor.partidaId, id));
  const res = materialResource(cur);
  if (!can(actor, "view", res)) throw notFound("Material no encontrado");
  if ((body.titulo !== undefined || body.contenido !== undefined) && !can(actor, "edit", res)) throw forbidden("No puedes editar este material");
  if ((body.visibleATodos !== undefined || body.acceso !== undefined) && !can(actor, "changeAccess", res))
    throw forbidden("No puedes cambiar quién ve este material");
  const acceso = body.acceso ? cleanAcceso(ctx, actor.partidaId, cur.creadorId, body.acceso) : cur.acceso;
  ctx.db
    .prepare("UPDATE materiales SET titulo = ?, contenido = ?, visible_a_todos = ?, acceso = ? WHERE id = ?")
    .run(body.titulo ?? cur.titulo, body.contenido ?? cur.contenido, int(body.visibleATodos ?? cur.visibleATodos), JSON.stringify(acceso), id);
  ctx.notify.changed(actor.partidaId, ["materiales"]);
  return materialDto(getMaterialRow(ctx.db, actor.partidaId, id));
}

export function deleteMaterial(ctx: Ctx, actor: ServerActor, id: string): void {
  const cur = materialDto(getMaterialRow(ctx.db, actor.partidaId, id));
  const res = materialResource(cur);
  if (!can(actor, "view", res)) throw notFound("Material no encontrado");
  if (!can(actor, "delete", res)) throw forbidden("No puedes borrar este material");
  ctx.db.prepare("DELETE FROM materiales WHERE id = ?").run(id);
  ctx.notify.changed(actor.partidaId, ["materiales"]);
}

// ===========================================================================
// Música (playlists locales + reproducción sincronizada)
// ===========================================================================

export function createPlaylist(ctx: Ctx, actor: ServerActor, nombre: string): PlaylistDto {
  requireNarrator(actor);
  const id = uid();
  ctx.db.prepare("INSERT INTO playlists (id, partida_id, nombre) VALUES (?, ?, ?)").run(id, actor.partidaId, nombre);
  ctx.notify.changed(actor.partidaId, ["playlists"]);
  return { id, nombre, pistas: [] };
}

export function deletePlaylist(ctx: Ctx, actor: ServerActor, id: string): void {
  requireNarrator(actor);
  const ok = ctx.db.prepare("SELECT 1 AS ok FROM playlists WHERE id = ? AND partida_id = ?").get(id, actor.partidaId);
  if (!ok) throw notFound("Playlist no encontrada");
  const m = getMusic(ctx.db, actor.partidaId);
  const playing = m.pistaId && ctx.db.prepare("SELECT 1 AS ok FROM pistas WHERE id = ? AND playlist_id = ?").get(m.pistaId, id);
  ctx.db.prepare("DELETE FROM playlists WHERE id = ?").run(id);
  if (playing) controlMusic(ctx, actor, { accion: "stop" });
  ctx.notify.changed(actor.partidaId, ["playlists"]);
}

export function addPista(ctx: Ctx, actor: ServerActor, playlistId: string, body: { nombre: string; archivo: string }): PistaDto {
  requireNarrator(actor);
  const ok = ctx.db.prepare("SELECT 1 AS ok FROM playlists WHERE id = ? AND partida_id = ?").get(playlistId, actor.partidaId);
  if (!ok) throw notFound("Playlist no encontrada");
  const id = uid();
  const orden = Number((ctx.db.prepare("SELECT COALESCE(MAX(orden), -1) + 1 AS o FROM pistas WHERE playlist_id = ?").get(playlistId) as Row).o);
  ctx.db.prepare("INSERT INTO pistas (id, playlist_id, partida_id, nombre, archivo, orden) VALUES (?, ?, ?, ?, ?, ?)").run(id, playlistId, actor.partidaId, body.nombre, body.archivo, orden);
  ctx.notify.changed(actor.partidaId, ["playlists"]);
  return { id, nombre: body.nombre, archivo: body.archivo };
}

export function deletePista(ctx: Ctx, actor: ServerActor, pistaId: string): void {
  requireNarrator(actor);
  if (!getPista(ctx.db, actor.partidaId, pistaId)) throw notFound("Pista no encontrada");
  const m = getMusic(ctx.db, actor.partidaId);
  ctx.db.prepare("DELETE FROM pistas WHERE id = ?").run(pistaId);
  if (m.pistaId === pistaId) controlMusic(ctx, actor, { accion: "stop" });
  ctx.notify.changed(actor.partidaId, ["playlists"]);
}

export function musicDto(ctx: Ctx, partidaId: string): MusicDto {
  const state = getMusic(ctx.db, partidaId);
  return { ...state, pista: state.pistaId ? getPista(ctx.db, partidaId, state.pistaId) : null };
}

export function controlMusic(ctx: Ctx, actor: ServerActor, body: Body<typeof MusicBody>): MusicDto {
  requireNarrator(actor);
  const cur = getMusic(ctx.db, actor.partidaId);
  if (body.accion === "play" && body.pistaId && !getPista(ctx.db, actor.partidaId, body.pistaId)) throw notFound("Pista no encontrada");
  if (body.accion === "play" && !body.pistaId && !cur.pistaId) throw unprocessable("Elige una pista");
  const next = reduceMusic(cur, body, ctx.now());
  ctx.db.prepare("UPDATE partidas SET musica = ? WHERE id = ?").run(JSON.stringify(next), actor.partidaId);
  const dto = musicDto(ctx, actor.partidaId);
  ctx.notify.musica(actor.partidaId, { ...dto, serverNow: ctx.now() });
  return dto;
}
