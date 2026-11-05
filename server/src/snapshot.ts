import { can, isNarrator, type EscenaDto, type FichaDto, type Snapshot } from "@pyv/shared";
import type { Ctx, ServerActor } from "./ctx";
import {
  escenaDto,
  fichasDto,
  getPartidaRow,
  getUsuarioRow,
  catalogoDto,
  materialDto,
  npcDto,
  partidaDto,
  pjDto,
  playlistsDto,
  mensajeDto,
  tiradaDto,
  usuarioDto,
} from "./repo";
import { materialResource, musicDto, systemOf } from "./services";

const HISTORY = 100;

/**
 * Estado completo de la Partida filtrado para quien pregunta. Es la ÚNICA fuente de verdad de qué ve cada rol:
 * los eventos de Socket.IO solo avisan "algo cambió" y el cliente vuelve a pedir esto (también al reconectar).
 */
export function buildSnapshot(ctx: Ctx, actor: ServerActor): Snapshot {
  const { db } = ctx;
  const pid = actor.partidaId;
  const narrator = isNarrator(actor);
  const partidaRow = getPartidaRow(db, pid);
  const proyectada = (partidaRow.escena_proyectada_id as string | null) ?? null;
  const { id: sistemaId, system } = systemOf(ctx, pid);

  const usuarios = db.prepare("SELECT * FROM usuarios WHERE partida_id = ? ORDER BY rowid").all(pid).map(usuarioDto);

  // PJs: el Narrador ve todos; el jugador solo los suyos (nunca la hoja de otros).
  const pjs = db
    .prepare("SELECT * FROM pjs WHERE partida_id = ? ORDER BY rowid")
    .all(pid)
    .map((r) => pjDto(r, system))
    .filter((p) => can(actor, "view", { kind: "pj", ownerId: p.duenoId, edicionLibre: p.edicionLibre }));

  const npcs = db
    .prepare("SELECT * FROM npcs WHERE partida_id = ? ORDER BY rowid")
    .all(pid)
    .map(npcDto)
    .filter((n) => narrator || !n.oculto);

  // Escenas: el Narrador todas; el jugador solo la proyectada.
  const escenas: EscenaDto[] = db
    .prepare("SELECT * FROM escenas WHERE partida_id = ? ORDER BY orden, rowid")
    .all(pid)
    .map(escenaDto)
    .filter((e) => narrator || e.id === proyectada);

  // Fichas: el jugador solo las de la escena proyectada, no ocultas y que no sean de un NPC oculto.
  let fichaRows = db.prepare("SELECT * FROM fichas WHERE partida_id = ? ORDER BY rowid").all(pid);
  if (!narrator) {
    const hiddenNpcs = new Set(db.prepare("SELECT id FROM npcs WHERE partida_id = ? AND oculto = 1").all(pid).map((r) => String(r.id)));
    fichaRows = fichaRows.filter(
      (f) => f.escena_id === proyectada && Number(f.oculta) === 0 && !(f.ref_tipo === "npc" && hiddenNpcs.has(String(f.ref_id))),
    );
  }
  const fichas: FichaDto[] = fichasDto(db, pid, fichaRows, system);

  const tiradaRows = narrator
    ? db.prepare("SELECT * FROM tiradas WHERE partida_id = ? ORDER BY creada_en DESC, rowid DESC LIMIT ?").all(pid, HISTORY)
    : db
        .prepare(
          "SELECT * FROM tiradas WHERE partida_id = ? AND (visibilidad = 'publica' OR (visibilidad = 'autor_narradores' AND autor_id = ?)) ORDER BY creada_en DESC, rowid DESC LIMIT ?",
        )
        .all(pid, actor.id, HISTORY);

  const mensajeRows = db
    .prepare(
      "SELECT * FROM mensajes WHERE partida_id = ? AND (destinatario_id IS NULL OR autor_id = ? OR destinatario_id = ?) ORDER BY creada_en DESC, rowid DESC LIMIT ?",
    )
    .all(pid, actor.id, actor.id, HISTORY);

  const materiales = db
    .prepare("SELECT * FROM materiales WHERE partida_id = ? ORDER BY rowid")
    .all(pid)
    .map(materialDto)
    .filter((m) => can(actor, "view", materialResource(m)));

  return {
    yo: usuarioDto(getUsuarioRow(db, pid, actor.id)),
    partida: partidaDto(partidaRow, ctx.systems),
    usuarios,
    conectados: ctx.connected(pid),
    pjs,
    npcs,
    escenas,
    escenaProyectadaId: proyectada,
    fichas,
    catalogo: db.prepare("SELECT * FROM catalogo WHERE partida_id = ? AND sistema = ? ORDER BY rowid").all(pid, sistemaId).map(catalogoDto),
    tiradas: tiradaRows.map(tiradaDto).reverse(), // cronológico
    // Los jugadores no ven la biblioteca de música, solo lo que suena (musica.pista).
    mensajes: mensajeRows.map(mensajeDto).reverse(),
    playlists: narrator ? playlistsDto(db, pid) : [],
    musica: musicDto(ctx, pid),
    materiales,
    serverNow: ctx.now(),
  };
}
