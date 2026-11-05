// Interfaz del sistema genérico (lo trae el VTT base): hoja libre con nombre, notas y campos de texto.
// Las tiradas se hacen con los dados libres del panel o del chat (/r 2d6+1).
import { useEffect, useState } from "react";
import { GENERIC_FIELDS_MAX, GENERIC_SYSTEM_ID, genericoSystem, type GenericField, type GenericSheet, type PjDto } from "@pyv/shared";
import { patch, post } from "../api";
import { run } from "../store";
import { Button, Card, Empty, Field, Input, Modal, Select, Textarea } from "../ui";
import { newId, useMe, userName } from "../util";
import { NarratorPjControls, PjAvatar } from "../components/PjCommon";
import type { SystemUi } from "./types";

const asSheet = (pj: PjDto): GenericSheet => {
  const r = genericoSystem.sheet.schema.safeParse(pj.sheet);
  return r.success ? r.data : { nombre: pj.nombre, notas: "", campos: [] };
};

function GenericSheetView({ pj, onBack }: { pj: PjDto; onBack: () => void }) {
  const { snap, me, narrator } = useMe();
  const sheet = asSheet(pj);
  const isOwner = pj.duenoId === me.id;
  const canFull = narrator || (isOwner && pj.edicionLibre); // nombre e imagen
  const canTouch = narrator || isOwner; // notas y campos (playerSafeKeys)

  const [draft, setDraft] = useState<GenericSheet>(sheet);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const serverJson = JSON.stringify(sheet);
  // Si cambia en el servidor (otro usuario) y no hay cambios locales, mostrar lo nuevo.
  useEffect(() => {
    if (!dirty) setDraft(JSON.parse(serverJson) as GenericSheet);
  }, [serverJson, dirty]);

  const edit = (next: GenericSheet) => {
    setDraft(next);
    setDirty(true);
  };
  const setCampo = (id: string, p: Partial<GenericField>) => edit({ ...draft, campos: draft.campos.map((c) => (c.id === id ? { ...c, ...p } : c)) });

  const save = async () => {
    setSaving(true);
    const body: Partial<GenericSheet> = { notas: draft.notas, campos: draft.campos.filter((c) => c.nombre.trim() || c.valor.trim()) };
    if (canFull && draft.nombre.trim() !== sheet.nombre) body.nombre = draft.nombre.trim();
    const ok = await run(() => patch<PjDto>(`/api/pjs/${pj.id}`, { sheet: body }));
    setSaving(false);
    if (ok) setDirty(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Button small variant="ghost" onClick={onBack}>← Volver</Button>
        {canTouch && (
          <div className="flex gap-2">
            {dirty && <Button small variant="ghost" onClick={() => { setDirty(false); setDraft(sheet); }}>Descartar</Button>}
            <Button small variant="primary" disabled={!dirty || saving || !draft.nombre.trim()} onClick={() => void save()}>Guardar</Button>
          </div>
        )}
      </div>

      <Card>
        <div className="flex items-center gap-3">
          <PjAvatar pj={pj} editable={canFull} />
          <div className="min-w-0 flex-1">
            {canFull ? (
              <Input value={draft.nombre} maxLength={80} onChange={(e) => edit({ ...draft, nombre: e.target.value })} aria-label="Nombre del personaje" className="text-lg" />
            ) : (
              <h2 className="truncate text-xl text-gold">{sheet.nombre}</h2>
            )}
            {narrator && <p className="mt-1 text-sm text-muted">de {userName(snap, pj.duenoId)}</p>}
          </div>
        </div>
      </Card>

      <Card
        title="Campos"
        actions={
          canTouch && draft.campos.length < GENERIC_FIELDS_MAX ? (
            <Button small onClick={() => edit({ ...draft, campos: [...draft.campos, { id: newId(), nombre: "", valor: "" }] })}>+ Campo</Button>
          ) : undefined
        }
      >
        {draft.campos.length === 0 && <Empty>{canTouch ? "Añade campos como «Fuerza: 3» o «Clase: Pícaro»." : "Sin campos."}</Empty>}
        <ul className="space-y-2">
          {draft.campos.map((c) =>
            canTouch ? (
              <li key={c.id} className="flex items-start gap-2">
                <div className="w-2/5"><Input value={c.nombre} maxLength={80} placeholder="Nombre" aria-label="Nombre del campo" onChange={(e) => setCampo(c.id, { nombre: e.target.value })} /></div>
                <div className="flex-1"><Input value={c.valor} maxLength={2000} placeholder="Valor" aria-label={`Valor de ${c.nombre || "campo"}`} onChange={(e) => setCampo(c.id, { valor: e.target.value })} /></div>
                <Button small variant="ghost" aria-label={`Quitar ${c.nombre || "campo"}`} onClick={() => edit({ ...draft, campos: draft.campos.filter((x) => x.id !== c.id) })}>✕</Button>
              </li>
            ) : (
              <li key={c.id} className="flex gap-2 text-sm"><span className="w-2/5 text-muted">{c.nombre}</span><span className="flex-1 whitespace-pre-wrap">{c.valor}</span></li>
            ),
          )}
        </ul>
      </Card>

      <Card title="Notas">
        {canTouch ? (
          <Textarea value={draft.notas} maxLength={20_000} rows={6} onChange={(e) => edit({ ...draft, notas: e.target.value })} aria-label="Notas" />
        ) : (
          <p className="whitespace-pre-wrap text-sm">{sheet.notas || "—"}</p>
        )}
      </Card>

      <p className="text-xs text-muted">Para tirar dados usa la pestaña «Tiradas y chat» o escribe en el chat, p. ej. <code>/r 2d6+1</code>.</p>

      <NarratorPjControls pj={pj} onDeleted={onBack} freeEditHint="Edición libre: el jugador también puede cambiar el nombre y la imagen" />
    </div>
  );
}

function GenericCreate({ onClose, onCreated }: { onClose: () => void; onCreated: (pj: PjDto) => void }) {
  const { snap, me, narrator } = useMe();
  const [nombre, setNombre] = useState("");
  const [duenoId, setDuenoId] = useState<string>(me.id);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    const sheet = genericoSystem.sheet.empty!(nombre.trim());
    const pj = await run(() => post<PjDto>("/api/pjs", { sheet, duenoId: narrator ? duenoId || null : undefined }));
    setBusy(false);
    if (pj) {
      onCreated(pj);
      onClose();
    }
  };
  return (
    <Modal title="Nuevo personaje" onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (nombre.trim()) void create(); }}>
        <Field label="Nombre"><Input autoFocus value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} /></Field>
        {narrator && (
          <Field label="Dueño">
            <Select value={duenoId} onChange={(e) => setDuenoId(e.target.value)}>
              <option value="">Sin dueño</option>
              {snap.usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre} ({u.rol})</option>)}
            </Select>
          </Field>
        )}
        <p className="text-xs text-muted">Después podrás añadir notas y campos libres (nombre: valor) en la hoja.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={!nombre.trim() || busy}>Crear</Button>
        </div>
      </form>
    </Modal>
  );
}

export const genericoUi: SystemUi = {
  id: GENERIC_SYSTEM_ID,
  SheetView: GenericSheetView,
  CreationWizard: GenericCreate,
};
