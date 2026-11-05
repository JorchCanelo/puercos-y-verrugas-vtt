import { useState } from "react";
import type { NpcDto } from "@pyv/shared";
import { del, fileUrl, patch, post, upload } from "../api";
import { run, useStore } from "../store";
import { Button, ConfirmButton, Empty, Field, Input, Modal, Textarea, cx } from "../ui";
import { useMe, userName } from "../util";
import { useSystemUi } from "../systems/registry";
import { SystemUnavailableNotice, UnavailableSheet } from "./UnavailableSheet";

export function PjsPanel() {
  const { snap, narrator } = useMe();
  const selectedPjId = useStore((s) => s.selectedPjId);
  const selectPj = useStore((s) => s.selectPj);
  const [creating, setCreating] = useState(false);
  const ui = useSystemUi(); // null = sistema no instalado: solo lectura

  const selected = snap.pjs.find((p) => p.id === selectedPjId);
  if (selected) {
    const Sheet = ui?.SheetView ?? UnavailableSheet;
    return <Sheet pj={selected} onBack={() => selectPj(null)} />;
  }
  const Creation = ui?.CreationWizard;
  const Summary = ui?.PjSummary;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg text-gold">{narrator ? "Personajes de jugador" : "Mis personajes"}</h2>
        {Creation && <Button variant="primary" small onClick={() => setCreating(true)}>+ Nuevo personaje</Button>}
      </div>
      {!ui && <SystemUnavailableNotice />}

      {snap.pjs.length === 0 && <Empty>{narrator ? "Todavía no hay personajes." : "Aún no tienes personajes. Crea el primero."}</Empty>}
      <ul className="grid gap-2">
        {snap.pjs.map((p) => {
          const badge = ui?.pjBadge?.(p);
          return (
            <li key={p.id}>
              <button onClick={() => selectPj(p.id)} className="flex w-full items-center gap-3 rounded-xl border border-line bg-panel p-2.5 text-left transition hover:border-gold-dim">
                <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-panel-2 text-lg font-bold">
                  {p.imagen ? <img src={fileUrl(p.imagen) as string} alt="" className="h-full w-full object-cover" /> : p.nombre[0]?.toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{p.nombre}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    {Summary && <Summary pj={p} />}
                    {narrator && <span>{Summary ? "· " : ""}{userName(snap, p.duenoId)}</span>}
                  </span>
                </span>
                {badge && <span className="rounded-full bg-gold px-2 py-0.5 text-xs font-semibold text-night">{badge}</span>}
              </button>
            </li>
          );
        })}
      </ul>

      {narrator && <NpcSection />}
      {creating && Creation && <Creation onClose={() => setCreating(false)} onCreated={(pj) => selectPj(pj.id)} />}
    </div>
  );
}

function NpcSection() {
  const { snap } = useMe();
  const [editing, setEditing] = useState<NpcDto | "new" | null>(null);
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-lg text-gold">NPCs</h2>
        <Button small onClick={() => setEditing("new")}>+ Nuevo NPC</Button>
      </div>
      {snap.npcs.length === 0 && <Empty>Sin NPCs.</Empty>}
      <ul className="grid gap-2">
        {snap.npcs.map((n) => (
          <li key={n.id} className={cx("flex items-center gap-3 rounded-xl border border-line bg-panel p-2.5", n.oculto && "border-dashed opacity-70")}>
            <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-panel-2">
              {n.imagen ? <img src={fileUrl(n.imagen) as string} alt="" className="h-full w-full object-cover" /> : n.nombre[0]?.toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{n.nombre} {n.oculto && <span className="text-xs text-muted">(oculto)</span>}</span>
              {n.notas && <span className="line-clamp-1 text-xs text-muted">{n.notas}</span>}
            </span>
            <Button small onClick={() => void run(() => patch(`/api/npcs/${n.id}`, { oculto: !n.oculto }))}>{n.oculto ? "Revelar" : "Ocultar"}</Button>
            <Button small onClick={() => setEditing(n)}>Editar</Button>
          </li>
        ))}
      </ul>
      {editing && <NpcDialog npc={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function NpcDialog({ npc, onClose }: { npc: NpcDto | null; onClose: () => void }) {
  const [nombre, setNombre] = useState(npc?.nombre ?? "");
  const [notas, setNotas] = useState(npc?.notas ?? "");
  const [oculto, setOculto] = useState(npc?.oculto ?? true);
  const [imagen, setImagen] = useState<string | null>(npc?.imagen ?? null);
  return (
    <Modal title={npc ? "Editar NPC" : "Nuevo NPC"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Nombre"><Input value={nombre} onChange={(e) => setNombre(e.target.value)} /></Field>
        <Field label="Imagen">
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const up = await run(() => upload(f)); if (up) setImagen(up.archivo); } }} />
        </Field>
        <Field label="Notas (solo las ves tú si está oculto)"><Textarea value={notas} onChange={(e) => setNotas(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={oculto} onChange={(e) => setOculto(e.target.checked)} /> Oculto a los jugadores (también sus fichas)</label>
        <div className="flex justify-between gap-2">
          {npc ? <ConfirmButton variant="ghost" message="¿Eliminar?" onConfirm={async () => (await run(() => del(`/api/npcs/${npc.id}`))) && onClose()}>Eliminar</ConfirmButton> : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button variant="primary" disabled={!nombre.trim()} onClick={async () => {
              const body = { nombre: nombre.trim(), notas, oculto, imagen };
              if (await run(() => (npc ? patch(`/api/npcs/${npc.id}`, body) : post("/api/npcs", body)))) onClose();
            }}>Guardar</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
