import { useEffect, useRef, useState } from "react";
import { DICE_SIDES, FREE_DICE_MAX, FREE_MOD_MAX, FREE_MOD_MIN, parseChatRollCommand, parseDiceExpr, type MensajeDto, type TiradaDto } from "@pyv/shared";
import { del, post } from "../api";
import { run, useStore } from "../store";
import { Button, Card, ConfirmButton, Empty, Field, Input, Select, cx } from "../ui";
import { useMe } from "../util";
import { useSystemUi } from "../systems/registry";
import { RollCard } from "./RollView";

type FeedItem = { kind: "tirada"; t: TiradaDto; at: number } | { kind: "mensaje"; m: MensajeDto; at: number };

export function RollsPanel() {
  const { snap, narrator } = useMe();
  const MovesPanel = useSystemUi()?.MovesPanel;
  const feed: FeedItem[] = [
    ...snap.tiradas.map((t): FeedItem => ({ kind: "tirada", t, at: t.creadaEn })),
    ...snap.mensajes.map((m): FeedItem => ({ kind: "mensaje", m, at: m.creadaEn })),
  ].sort((a, b) => a.at - b.at);

  // Siempre mostrar lo más reciente (abajo, como un chat), sin mover la página entera.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed.length]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg text-gold">Tiradas y chat</h2>
        {narrator && (
          <ConfirmButton small variant="ghost" message="¿Borrar tiradas y chat para todos?" onConfirm={() => void run(() => del("/api/registro"))}>
            Limpiar registro
          </ConfirmButton>
        )}
      </div>
      <div ref={listRef} className="max-h-[50vh] min-h-32 space-y-2 overflow-y-auto rounded-lg border border-line p-2" aria-live="polite" aria-label="Registro de tiradas y chat">
        {feed.length === 0 && <Empty>Aún no hay tiradas ni mensajes.</Empty>}
        {feed.map((it) => (it.kind === "tirada" ? <RollCard key={`t${it.t.id}`} t={it.t} /> : <MessageCard key={`m${it.m.id}`} m={it.m} />))}
      </div>
      <Card>
        {MovesPanel && (
          <div className="mb-3 border-b border-line pb-3">
            <MovesPanel />
          </div>
        )}
        <DiceRoller />
        <div className="mt-3 border-t border-line pt-3">
          <Composer />
        </div>
      </Card>
    </div>
  );
}

function MessageCard({ m }: { m: MensajeDto }) {
  const { me } = useMe();
  const hora = new Date(m.creadaEn).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  const whisper = m.destinatarioId !== null;
  const mine = m.autorId === me.id;
  return (
    <article className={cx("rounded-lg border p-2.5", whisper ? "border-dashed border-gold-dim bg-gold/5" : "border-line bg-night/40")} aria-label={whisper ? "Susurro" : "Mensaje"}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs text-muted">
        <span>
          <strong className="text-ink">{m.remitenteNombre}</strong>
          {m.remitenteNombre !== m.autorNombre && ` · ${m.autorNombre}`}
          {whisper && <span className="text-gold"> · 🤫 {mine ? `susurro para ${m.destinatarioNombre}` : "susurro para ti"}</span>}
        </span>
        <span>{hora}</span>
      </header>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm">{m.texto}</p>
    </article>
  );
}

/** Escribir como tu usuario o como un PJ (el Narrador, como cualquiera), en público o susurrando a una persona. */
function Composer() {
  const { snap, me } = useMe();
  const [texto, setTexto] = useState("");
  const [pjId, setPjId] = useState("");
  const [dest, setDest] = useState("");
  const [sending, setSending] = useState(false);
  const pjs = snap.pjs;
  const others = snap.usuarios.filter((u) => u.id !== me.id);
  const validPj = pjs.some((p) => p.id === pjId) ? pjId : "";
  const validDest = others.some((u) => u.id === dest) ? dest : "";

  const send = async () => {
    const t = texto.trim();
    if (!t || sending) return;
    // Comandos de dados: "/r 3d8+2" (pública) y "/rp 3d8+2" (privada). No se envían como mensaje.
    const cmd = parseChatRollCommand(t);
    if (cmd) {
      const expr = parseDiceExpr(cmd.expr || "1d20");
      if ("error" in expr) {
        useStore.getState().toast(expr.error, "error");
        return;
      }
      setSending(true);
      const tirada = await run(() => post<TiradaDto>("/api/tiradas/libre", { ...expr, privada: cmd.privada }));
      setSending(false);
      if (tirada) {
        setTexto("");
        useStore.getState().pushTirada(tirada);
      }
      return;
    }
    setSending(true);
    const m = await run(() => post<MensajeDto>("/api/chat", { texto: t, pjId: validPj || null, destinatarioId: validDest || null }));
    setSending(false);
    if (m) {
      setTexto("");
      useStore.getState().pushMensaje(m);
    }
  };

  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Enviar como">
          <Select value={validPj} onChange={(e) => setPjId(e.target.value)}>
            <option value="">{me.nombre} (usuario)</option>
            {pjs.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </Select>
        </Field>
        <Field label="Para">
          <Select value={validDest} onChange={(e) => setDest(e.target.value)}>
            <option value="">Todos (público)</option>
            {others.map((u) => <option key={u.id} value={u.id}>🤫 Susurrar a {u.nombre}{u.rol === "narrador" ? " (Narrador)" : ""}</option>)}
          </Select>
        </Field>
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Input value={texto} maxLength={2000} onChange={(e) => setTexto(e.target.value)} placeholder={validDest ? "Escribe un susurro…" : "Escribe un mensaje… (/r 2d6+1 para tirar)"} aria-label="Mensaje" />
        <Button type="submit" variant="primary" disabled={!texto.trim() || sending}>{parseChatRollCommand(texto) ? "Tirar" : validDest ? "Susurrar" : "Enviar"}</Button>
      </form>
      <p className="mt-1 text-xs text-muted">
        Dados desde el chat: <code>/r 3d8+2</code> (pública) o <code>/rp 1d20</code> (privada).
      </p>
    </div>
  );
}

const clampInt = (v: string, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

/**
 * Tirada libre (cualquier usuario): n dados de d2, d4, d6, d8, d10, d12, d20 o d100 + modificador.
 * Privada: Jugador → él y los Narradores; Narrador → solo Narradores.
 */
function DiceRoller() {
  const { narrator } = useMe();
  const [cantidad, setCantidad] = useState(1);
  const [caras, setCaras] = useState(20);
  const [modificador, setModificador] = useState(0);
  const [privada, setPrivada] = useState(false);
  const [rolling, setRolling] = useState(false);
  const mod = modificador > 0 ? `+${modificador}` : modificador < 0 ? `${modificador}` : "";

  const roll = async () => {
    if (rolling) return;
    setRolling(true);
    const t = await run(() => post<TiradaDto>("/api/tiradas/libre", { cantidad, caras, modificador, privada }));
    setRolling(false);
    if (t) useStore.getState().pushTirada(t);
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-20">
          <Field label="Cantidad">
            <Input type="number" min={1} max={FREE_DICE_MAX} value={cantidad} onChange={(e) => setCantidad(clampInt(e.target.value, 1, FREE_DICE_MAX, 1))} />
          </Field>
        </div>
        <div className="w-24">
          <Field label="Dado">
            <Select value={caras} onChange={(e) => setCaras(Number(e.target.value))}>
              {DICE_SIDES.map((d) => (
                <option key={d} value={d}>d{d}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-24">
          <Field label="Modificador">
            <Input type="number" min={FREE_MOD_MIN} max={FREE_MOD_MAX} value={modificador} onChange={(e) => setModificador(clampInt(e.target.value, FREE_MOD_MIN, FREE_MOD_MAX, 0))} />
          </Field>
        </div>
        <Button variant="primary" disabled={rolling} onClick={() => void roll()}>
          Tirar {cantidad}d{caras}{mod}
        </Button>
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={privada} onChange={(e) => setPrivada(e.target.checked)} /> Privada{narrator ? " (solo Narradores)" : " (solo tú y los Narradores)"}
      </label>
    </div>
  );
}
