import { useState } from "react";
import { can, type MaterialAcceso, type MaterialDto, type Resource } from "@pyv/shared";
import { del, fileUrl, patch, post, upload } from "../api";
import { run } from "../store";
import { Button, Card, ConfirmButton, Empty, Field, Input, Modal, Select, Textarea, cx } from "../ui";
import { useMe, userName } from "../util";

const ICON = { nota: "📝", imagen: "🖼️", pdf: "📄" } as const;

const resourceOf = (m: MaterialDto): Resource => ({
  kind: "material",
  tipo: m.tipo,
  creadorId: m.creadorId,
  seccion: m.seccion,
  visibleATodos: m.visibleATodos,
  acceso: m.acceso,
});

export function MaterialsPanel() {
  const { snap, narrator } = useMe();
  const [creating, setCreating] = useState<"grupo" | "narrador" | null>(null);
  const grupo = snap.materiales.filter((m) => m.seccion === "grupo");
  const delNarrador = snap.materiales.filter((m) => m.seccion === "narrador");
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg text-gold">Notas de grupo</h2>
          <Button small variant="primary" onClick={() => setCreating("grupo")}>+ Subir</Button>
        </div>
        <p className="text-xs text-muted">Lo que subes aquí lo ven los demás jugadores; tú decides quién. Los Narradores siempre lo ven.</p>
        {grupo.length === 0 && <Empty>Nadie ha subido notas todavía.</Empty>}
        {grupo.map((m) => <MaterialItem key={m.id} m={m} />)}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg text-gold">{narrator ? "Materiales del Narrador" : "Materiales para ti"}</h2>
          {narrator && <Button small onClick={() => setCreating("narrador")}>+ Nuevo</Button>}
        </div>
        {delNarrador.length === 0 && <Empty>{narrator ? "Crea notas, imágenes o PDFs y asígnalos a tus jugadores." : "El Narrador no te ha asignado materiales."}</Empty>}
        {delNarrador.map((m) => <MaterialItem key={m.id} m={m} />)}
      </section>

      {creating && <MaterialDialog seccion={creating} onClose={() => setCreating(null)} />}
    </div>
  );
}

function MaterialItem({ m }: { m: MaterialDto }) {
  const { snap, me } = useMe();
  const [open, setOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [text, setText] = useState(m.contenido);
  const res = resourceOf(m);
  const canEdit = can({ id: me.id, rol: me.rol }, "edit", res);
  const canShare = can({ id: me.id, rol: me.rol }, "changeAccess", res);
  const canDelete = can({ id: me.id, rol: me.rol }, "delete", res);
  const url = fileUrl(m.archivo);

  return (
    <Card className="!p-0">
      <button className="flex w-full items-center gap-2 p-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span aria-hidden>{ICON[m.tipo]}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{m.titulo}</span>
          <span className="text-xs text-muted">
            {userName(snap, m.creadorId)} · {m.visibleATodos ? "visible para todos" : m.acceso.length > 0 ? `compartido con ${m.acceso.length}` : "privado"}
          </span>
        </span>
        <span className="text-muted">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-line p-3">
          {m.tipo === "nota" &&
            (canEdit ? (
              <>
                <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-32" />
                <Button small variant="primary" disabled={text === m.contenido} onClick={() => void run(() => patch(`/api/materiales/${m.id}`, { contenido: text }))}>Guardar cambios</Button>
              </>
            ) : (
              <p className="whitespace-pre-wrap text-sm">{m.contenido || <span className="text-muted">(vacía)</span>}</p>
            ))}
          {m.tipo === "imagen" && url && (
            <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={m.titulo} className="max-h-96 rounded-lg" /></a>
          )}
          {m.tipo === "pdf" && url && <a className="inline-block rounded-md border border-line bg-panel-2 px-3 py-2 text-sm hover:border-gold-dim" href={url} target="_blank" rel="noreferrer">Abrir PDF ↗</a>}
          <div className="flex flex-wrap gap-2">
            {canShare && <Button small onClick={() => setSharing(true)}>Compartir…</Button>}
            {canDelete && <ConfirmButton small variant="ghost" message="¿Borrar?" onConfirm={() => void run(() => del(`/api/materiales/${m.id}`))}>Borrar</ConfirmButton>}
          </div>
        </div>
      )}
      {sharing && <ShareDialog m={m} onClose={() => setSharing(false)} />}
    </Card>
  );
}

/** Quién puede ver / editar: todos, o usuarios concretos (los Narradores siempre ven todo). */
function AccessEditor({ visibleATodos, setVisible, acceso, setAcceso, ownerId }: { visibleATodos: boolean; setVisible: (b: boolean) => void; acceso: MaterialAcceso[]; setAcceso: (a: MaterialAcceso[]) => void; ownerId: string }) {
  const { snap } = useMe();
  const others = snap.usuarios.filter((u) => u.id !== ownerId && u.rol === "jugador");
  const levelOf = (id: string) => acceso.find((a) => a.usuarioId === id)?.nivel ?? "";
  const setLevel = (id: string, nivel: string) => setAcceso([...acceso.filter((a) => a.usuarioId !== id), ...(nivel ? [{ usuarioId: id, nivel: nivel as MaterialAcceso["nivel"] }] : [])]);
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={visibleATodos} onChange={(e) => setVisible(e.target.checked)} /> Visible para todos los jugadores</label>
      <div className={cx("space-y-1", visibleATodos && "opacity-50")}>
        {others.length === 0 && <p className="text-xs text-muted">No hay otros jugadores.</p>}
        {others.map((u) => (
          <div key={u.id} className="flex items-center gap-2">
            <span className="flex-1 truncate text-sm">{u.nombre}</span>
            <Select value={levelOf(u.id)} onChange={(e) => setLevel(u.id, e.target.value)} className="w-auto" aria-label={`Acceso de ${u.nombre}`}>
              <option value="">Sin acceso</option>
              <option value="ver">Puede ver</option>
              <option value="editar">Puede editar</option>
            </Select>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShareDialog({ m, onClose }: { m: MaterialDto; onClose: () => void }) {
  const [visible, setVisible] = useState(m.visibleATodos);
  const [acceso, setAcceso] = useState(m.acceso);
  return (
    <Modal title={`Compartir «${m.titulo}»`} onClose={onClose}>
      <AccessEditor visibleATodos={visible} setVisible={setVisible} acceso={acceso} setAcceso={setAcceso} ownerId={m.creadorId} />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" onClick={async () => (await run(() => patch(`/api/materiales/${m.id}`, { visibleATodos: visible, acceso }))) && onClose()}>Guardar</Button>
      </div>
    </Modal>
  );
}

function MaterialDialog({ seccion, onClose }: { seccion: "grupo" | "narrador"; onClose: () => void }) {
  const { me } = useMe();
  const [tipo, setTipo] = useState<MaterialDto["tipo"]>("nota");
  const [titulo, setTitulo] = useState("");
  const [contenido, setContenido] = useState("");
  const [archivo, setArchivo] = useState<string | null>(null);
  const [visible, setVisible] = useState(seccion === "grupo");
  const [acceso, setAcceso] = useState<MaterialAcceso[]>([]);
  const [uploading, setUploading] = useState(false);
  const ready = titulo.trim() && (tipo === "nota" || archivo) && !uploading;
  return (
    <Modal title={seccion === "grupo" ? "Subir a Notas de grupo" : "Nuevo material del Narrador"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Tipo">
          <Select value={tipo} onChange={(e) => { setTipo(e.target.value as MaterialDto["tipo"]); setArchivo(null); }}>
            <option value="nota">Nota de texto</option>
            <option value="imagen">Imagen</option>
            <option value="pdf">PDF</option>
          </Select>
        </Field>
        <Field label="Título"><Input value={titulo} onChange={(e) => setTitulo(e.target.value)} /></Field>
        {tipo === "nota" ? (
          <Field label="Contenido"><Textarea value={contenido} onChange={(e) => setContenido(e.target.value)} className="min-h-32" /></Field>
        ) : (
          <Field label="Archivo" hint={tipo === "imagen" ? "PNG, JPG, WebP o GIF." : "Solo se puede subir, no editar."}>
            <input type="file" accept={tipo === "imagen" ? "image/png,image/jpeg,image/webp,image/gif" : "application/pdf"} onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setUploading(true);
              const up = await run(() => upload(f));
              setUploading(false);
              setArchivo(up?.archivo ?? null);
            }} />
          </Field>
        )}
        <AccessEditor visibleATodos={visible} setVisible={setVisible} acceso={acceso} setAcceso={setAcceso} ownerId={me.id} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={!ready} onClick={async () => (await run(() => post("/api/materiales", { tipo, titulo: titulo.trim(), contenido, archivo, seccion, visibleATodos: visible, acceso }))) && onClose()}>
            {uploading ? "Subiendo…" : "Guardar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
