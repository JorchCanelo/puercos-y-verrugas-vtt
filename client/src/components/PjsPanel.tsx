import { useState } from "react";
import type { Acceso, NpcDto, PjDto } from "@pyv/shared";
import { del, fileUrl, patch, post, upload } from "../api";
import { run, useStore } from "../store";
import { Button, ConfirmButton, Empty, Field, Input, Modal, Textarea, cx } from "../ui";
import { useMe, userName } from "../util";
import { useSystemUi } from "../systems/registry";
import { SystemUnavailableNotice, UnavailableSheet } from "./UnavailableSheet";
import { FolderGroups, FolderInput, folderNames } from "./Folders";
import { AccessEditor, NIVEL_LABEL, accessSummary } from "./AccessEditor";
import { TokenControls, useTokenHidden } from "./TokenControls";
import { canHandle, canPlace, tokenDragProps, useBoardScene, type TokenRef } from "../tokens";

/** Fila de la lista que se puede arrastrar al tablero para poner su ficha. */
function useDrag(tokenRef: TokenRef) {
  const { snap, me } = useMe();
  return tokenDragProps(tokenRef, canPlace(snap, me, useBoardScene(), tokenRef));
}

const rowCls = (tokenHidden: boolean) =>
  cx("flex items-center gap-2 rounded-xl border border-line bg-panel p-2.5", tokenHidden && "border-dashed opacity-75");

export function PjsPanel() {
  const { snap, me, narrator } = useMe();
  const boardScene = useBoardScene();
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
  const handles = (ref: TokenRef) => canHandle(snap, me, boardScene, ref);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg text-gold">{narrator ? "Personajes de jugador" : "Mis personajes"}</h2>
        {Creation && <Button variant="primary" small onClick={() => setCreating(true)}>+ Nuevo personaje</Button>}
      </div>
      {!ui && <SystemUnavailableNotice />}

      {snap.pjs.length === 0 && <Empty>{narrator ? "Todavía no hay personajes." : "Aún no tienes personajes. Crea el primero."}</Empty>}
      {boardScene && (snap.pjs.some((p) => handles({ tipo: "pj", id: p.id })) || snap.npcs.some((n) => handles({ tipo: "npc", id: n.id }))) && (
        <p className="text-xs text-muted">Arrastra un personaje al tablero (o pulsa 📍) para ponerlo en «{boardScene.nombre}»; ➡️ lo quita.</p>
      )}
      <div className="grid gap-2">
        {snap.pjs.map((p) => (
          <PjRow key={p.id} p={p} onOpen={() => selectPj(p.id)} />
        ))}
      </div>

      <NpcSection />
      {creating && Creation && <Creation onClose={() => setCreating(false)} onCreated={(pj) => selectPj(pj.id)} />}
    </div>
  );
}

function PjRow({ p, onOpen }: { p: PjDto; onOpen: () => void }) {
  const { snap, narrator } = useMe();
  const ui = useSystemUi();
  const Summary = ui?.PjSummary;
  const badge = ui?.pjBadge?.(p);
  const tokenRef: TokenRef = { tipo: "pj", id: p.id };
  const hidden = useTokenHidden(tokenRef);
  return (
    <div className={cx(rowCls(hidden), "transition hover:border-gold-dim")} {...useDrag(tokenRef)}>
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <Avatar imagen={p.imagen} nombre={p.nombre} big />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{p.nombre}</span>
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {Summary && <Summary pj={p} />}
            {narrator && <span>{Summary ? "· " : ""}{userName(snap, p.duenoId)}</span>}
          </span>
        </span>
        {badge && <span className="rounded-full bg-gold px-2 py-0.5 text-xs font-semibold text-night">{badge}</span>}
      </button>
      <TokenControls tokenRef={tokenRef} nombre={p.nombre} />
    </div>
  );
}

function Avatar({ imagen, nombre, big }: { imagen: string | null; nombre: string; big?: boolean }) {
  return (
    <span className={cx("grid shrink-0 place-items-center overflow-hidden rounded-full bg-panel-2 font-bold", big ? "h-12 w-12 text-lg" : "h-10 w-10")}>
      {imagen ? <img src={fileUrl(imagen) as string} alt="" className="h-full w-full object-cover" /> : nombre[0]?.toUpperCase()}
    </span>
  );
}

/** Nivel del jugador sobre un NPC (los jugadores solo reciben su propia entrada). */
const myLevel = (n: NpcDto, meId: string): Acceso["nivel"] | null => n.acceso.find((a) => a.usuarioId === meId)?.nivel ?? null;

/** NPCs: el Narrador ve y gestiona todos; un jugador, los que tiene como observador o propietario. */
function NpcSection() {
  const { snap, narrator } = useMe();
  const [editing, setEditing] = useState<NpcDto | "new" | null>(null);
  if (!narrator && snap.npcs.length === 0) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-lg text-gold">{narrator ? "NPCs" : "NPCs compartidos contigo"}</h2>
        {narrator && <Button small onClick={() => setEditing("new")}>+ Nuevo NPC</Button>}
      </div>
      {snap.npcs.length === 0 && <Empty>Sin NPCs.</Empty>}
      <FolderGroups items={snap.npcs} storageKey="npcs" render={(n) => <NpcRow key={n.id} n={n} onOpen={() => setEditing(n)} />} />
      {editing && <NpcDialog npc={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function NpcRow({ n, onOpen }: { n: NpcDto; onOpen: () => void }) {
  const { snap, me, narrator } = useMe();
  const tokenRef: TokenRef = { tipo: "npc", id: n.id };
  const hidden = useTokenHidden(tokenRef);
  const level = myLevel(n, me.id);
  const sub = narrator ? (n.acceso.length ? accessSummary(n.acceso, (id) => userName(snap, id)) : n.notas) : level ? NIVEL_LABEL[level] : "";
  return (
    <div className={rowCls(hidden)} {...useDrag(tokenRef)}>
      <Avatar imagen={n.imagen} nombre={n.nombre} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{n.nombre}</span>
        {sub && <span className="line-clamp-1 text-xs text-muted">{sub}</span>}
      </span>
      <Button small onClick={onOpen}>{narrator || level === "propietario" ? "Editar" : "Ver"}</Button>
      <TokenControls tokenRef={tokenRef} nombre={n.nombre} />
    </div>
  );
}

/** Narrador: todo, incluidos carpeta y permisos. Propietario: nombre, imagen y notas, y borrarlo. Observador: solo ver. */
function NpcDialog({ npc, onClose }: { npc: NpcDto | null; onClose: () => void }) {
  const { snap, me, narrator } = useMe();
  const level = npc ? myLevel(npc, me.id) : null;
  const canEdit = narrator || level === "propietario";
  const [nombre, setNombre] = useState(npc?.nombre ?? "");
  const [notas, setNotas] = useState(npc?.notas ?? "");
  const [imagen, setImagen] = useState<string | null>(npc?.imagen ?? null);
  const [carpeta, setCarpeta] = useState(npc?.carpeta ?? "");
  const [acceso, setAcceso] = useState<Acceso[]>(npc?.acceso ?? []);

  if (!canEdit && npc)
    return (
      <Modal title={npc.nombre} onClose={onClose}>
        <div className="space-y-3">
          {npc.imagen && <img src={fileUrl(npc.imagen) as string} alt="" className="max-h-72 rounded-lg" />}
          <p className="whitespace-pre-wrap text-sm">{npc.notas || <span className="text-muted">(sin notas)</span>}</p>
          <div className="flex justify-end"><Button onClick={onClose}>Cerrar</Button></div>
        </div>
      </Modal>
    );

  return (
    <Modal title={npc ? "Editar NPC" : "Nuevo NPC"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Nombre"><Input value={nombre} onChange={(e) => setNombre(e.target.value)} /></Field>
        <Field label="Imagen">
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const up = await run(() => upload(f)); if (up) setImagen(up.archivo); } }} />
        </Field>
        <Field label="Notas" hint={narrator ? "Solo las ven los Narradores y los jugadores observadores o propietarios." : undefined}>
          <Textarea value={notas} onChange={(e) => setNotas(e.target.value)} />
        </Field>
        {narrator && (
          <>
            <Field label="Carpeta" hint="Para organizar la lista. Escribe una nueva o elige una existente; vacío = sin carpeta.">
              <FolderInput id="npc-carpetas" value={carpeta} onChange={setCarpeta} options={folderNames(snap.npcs)} />
            </Field>
            <div className="space-y-1">
              <p className="text-sm">Permisos de los jugadores</p>
              <AccessEditor
                acceso={acceso}
                setAcceso={setAcceso}
                help="Ninguno: solo ve su ficha en el tablero. Observador: ve sus datos y notas. Propietario: además edita nombre, imagen y notas, lo borra y maneja su ficha como la de su PJ."
              />
            </div>
          </>
        )}
        <div className="flex justify-between gap-2">
          {npc ? <ConfirmButton variant="ghost" message="¿Eliminar?" onConfirm={async () => (await run(() => del(`/api/npcs/${npc.id}`))) && onClose()}>Eliminar</ConfirmButton> : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button variant="primary" disabled={!nombre.trim()} onClick={async () => {
              const body = narrator ? { nombre: nombre.trim(), notas, imagen, carpeta: carpeta.trim(), acceso } : { nombre: nombre.trim(), notas, imagen };
              if (await run(() => (npc ? patch(`/api/npcs/${npc.id}`, body) : post("/api/npcs", body)))) onClose();
            }}>Guardar</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
