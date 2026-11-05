import { useState } from "react";
import type { EscenaDto, FichaDto } from "@pyv/shared";
import { del, fileUrl, patch, post, put, upload } from "../api";
import { run, useStore } from "../store";
import { Button, Card, ConfirmButton, Empty, Field, Input, Modal, Select, cx } from "../ui";
import { useMe } from "../util";

/** Primera casilla libre de una cuadrícula (recorre por filas). */
function firstFreeCell(e: EscenaDto, fichas: FichaDto[]): { x: number; y: number } {
  const taken = new Set(fichas.map((f) => `${f.x},${f.y}`));
  for (let y = 0; y < e.filas; y++) for (let x = 0; x < e.columnas; x++) if (!taken.has(`${x},${y}`)) return { x, y };
  return { x: 0, y: 0 };
}

export function ScenesPanel() {
  const { snap } = useMe();
  const viewSceneId = useStore((s) => s.viewSceneId);
  const viewScene = useStore((s) => s.viewScene);
  const [editing, setEditing] = useState<EscenaDto | "new" | null>(null);
  const current = snap.escenas.find((e) => e.id === (viewSceneId ?? snap.escenaProyectadaId)) ?? snap.escenas.find((e) => e.abierta);

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
      {current && <TokensCard escena={current} />}
      {editing && <SceneDialog escena={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TokensCard({ escena }: { escena: EscenaDto }) {
  const { snap } = useMe();
  const fichas = snap.fichas.filter((f) => f.escenaId === escena.id);
  const placed = new Set(fichas.map((f) => `${f.ref.tipo}:${f.ref.id}`));
  const options = [
    ...snap.pjs.map((p) => ({ key: `pj:${p.id}`, tipo: "pj" as const, id: p.id, label: `${p.nombre} (PJ)` })),
    ...snap.npcs.map((n) => ({ key: `npc:${n.id}`, tipo: "npc" as const, id: n.id, label: `${n.nombre} (NPC)` })),
  ].filter((o) => !placed.has(o.key));
  const [pick, setPick] = useState("");
  const chosen = options.find((o) => o.key === pick) ?? options[0];

  const add = () => {
    if (!chosen) return;
    const pos = escena.tipo === "cuadricula" ? firstFreeCell(escena, fichas) : { x: 0.5, y: 0.5 };
    void run(() => post(`/api/escenas/${escena.id}/fichas`, { ref: { tipo: chosen.tipo, id: chosen.id }, ...pos, oculta: chosen.tipo === "npc" }));
  };

  return (
    <Card title={`Fichas en «${escena.nombre}»`}>
      <div className="flex gap-2">
        <Select value={chosen?.key ?? ""} onChange={(e) => setPick(e.target.value)} disabled={options.length === 0} aria-label="Personaje a añadir">
          {options.length === 0 && <option value="">Todos están en la escena</option>}
          {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </Select>
        <Button disabled={!chosen} onClick={add}>Añadir</Button>
      </div>
      <p className="mt-1 text-xs text-muted">Los NPC entran ocultos. Arrastra las fichas en el tablero para moverlas.</p>
      <ul className="mt-3 divide-y divide-line">
        {fichas.length === 0 && <li className="py-2 text-sm text-muted">Sin fichas.</li>}
        {fichas.map((f) => (
          <li key={f.id} className="flex items-center gap-2 py-1.5">
            <span className="flex-1 truncate text-sm">{f.nombre} <span className="text-xs text-muted">{f.ref.tipo === "npc" ? "NPC" : "PJ"}{f.oculta && " · oculta"}</span></span>
            <Button small onClick={() => void run(() => patch(`/api/fichas/${f.id}`, { oculta: !f.oculta }))}>{f.oculta ? "Mostrar" : "Ocultar"}</Button>
            <Button small variant="ghost" onClick={() => void run(() => del(`/api/fichas/${f.id}`))} aria-label={`Quitar ${f.nombre}`}>✕</Button>
          </li>
        ))}
      </ul>
    </Card>
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
