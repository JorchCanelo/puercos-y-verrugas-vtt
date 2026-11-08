import { useState } from "react";
import type { EscenaDto } from "@pyv/shared";
import { del, fileUrl, patch, post, put, upload } from "../api";
import { run, useStore } from "../store";
import { Button, ConfirmButton, Empty, Field, Input, Modal, Select, cx } from "../ui";
import { useMe } from "../util";

export function ScenesPanel() {
  const { snap } = useMe();
  const viewScene = useStore((s) => s.viewScene);
  const [editing, setEditing] = useState<EscenaDto | "new" | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg text-gold">Escenas</h2>
        <Button small variant="primary" onClick={() => setEditing("new")}>+ Nueva escena</Button>
      </div>
      {snap.escenas.length === 0 && <Empty>Crea una escena: una imagen sola o una cuadrícula de AxB casillas.</Empty>}
      <ul className="grid gap-2">
        {snap.escenas.map((e) => {
          const projected = e.id === snap.escenaProyectadaId;
          return (
            <li key={e.id} className={cx("rounded-xl border bg-panel p-2.5", projected ? "border-gold" : "border-line", !e.abierta && "opacity-70")}>
              <div className="flex items-center gap-3">
                <span className="h-12 w-16 shrink-0 overflow-hidden rounded bg-panel-2">
                  {e.imagen && <img src={fileUrl(e.imagen) as string} alt="" className="h-full w-full object-cover" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{e.nombre}</span>
                  <span className="text-xs text-muted">
                    {e.tipo === "cuadricula" ? `Cuadrícula ${e.columnas}×${e.filas}` : "Imagen"} · {e.abierta ? "abierta" : "cerrada"}
                    {projected && " · 📺 proyectada"}
                  </span>
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button small onClick={() => (viewScene(e.id), run(() => (e.abierta ? Promise.resolve() : patch(`/api/escenas/${e.id}`, { abierta: true }))))}>Ver</Button>
                {!projected && <Button small variant="primary" onClick={() => void run(() => put("/api/proyeccion", { escenaId: e.id }))}>Proyectar</Button>}
                <Button small onClick={() => void run(() => patch(`/api/escenas/${e.id}`, { abierta: !e.abierta }))}>{e.abierta ? "Cerrar" : "Abrir"}</Button>
                <Button small variant="ghost" onClick={() => setEditing(e)}>Editar</Button>
              </div>
            </li>
          );
        })}
      </ul>
      {editing && <SceneDialog escena={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SceneDialog({ escena, onClose }: { escena: EscenaDto | null; onClose: () => void }) {
  const [nombre, setNombre] = useState(escena?.nombre ?? "");
  const [tipo, setTipo] = useState<EscenaDto["tipo"]>(escena?.tipo ?? "imagen");
  const [columnas, setColumnas] = useState(escena?.columnas ?? 12);
  const [filas, setFilas] = useState(escena?.filas ?? 8);
  const [imagen, setImagen] = useState<string | null>(escena?.imagen ?? null);
  const [uploading, setUploading] = useState(false);
  return (
    <Modal title={escena ? "Editar escena" : "Nueva escena"} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Nombre"><Input value={nombre} onChange={(e) => setNombre(e.target.value)} /></Field>
        <Field label="Tipo">
          <Select value={tipo} onChange={(e) => setTipo(e.target.value as EscenaDto["tipo"])}>
            <option value="imagen">Solo imagen (fichas libres)</option>
            <option value="cuadricula">Cuadrícula (fichas por casillas)</option>
          </Select>
        </Field>
        {tipo === "cuadricula" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Columnas (ancho)"><Input type="number" min={1} max={200} value={columnas} onChange={(e) => setColumnas(Math.max(1, Math.min(200, Math.round(Number(e.target.value) || 1))))} /></Field>
            <Field label="Filas (alto)"><Input type="number" min={1} max={200} value={filas} onChange={(e) => setFilas(Math.max(1, Math.min(200, Math.round(Number(e.target.value) || 1))))} /></Field>
          </div>
        )}
        <Field label="Imagen de fondo" hint="PNG, JPG, WebP o GIF (máx. 20 MB).">
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setUploading(true);
            const up = await run(() => upload(f));
            setUploading(false);
            if (up) setImagen(up.archivo);
          }} />
        </Field>
        {imagen && <img src={fileUrl(imagen) as string} alt="" className="max-h-32 rounded" />}
        <div className="flex justify-between gap-2">
          {escena ? <ConfirmButton variant="ghost" message="¿Eliminar?" onConfirm={async () => (await run(() => del(`/api/escenas/${escena.id}`))) && onClose()}>Eliminar</ConfirmButton> : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button variant="primary" disabled={!nombre.trim() || uploading} onClick={async () => {
              const body = { nombre: nombre.trim(), tipo, columnas, filas, imagen };
              const ok = await run(() => (escena ? patch(`/api/escenas/${escena.id}`, body) : post("/api/escenas", body)));
              if (ok) onClose();
            }}>Guardar</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
