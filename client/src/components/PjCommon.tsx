// Piezas de la hoja que no dependen del sistema de juego: avatar y ajustes del Narrador.
import { useRef } from "react";
import type { PjDto } from "@pyv/shared";
import { del, fileUrl, patch, upload } from "../api";
import { run } from "../store";
import { Card, ConfirmButton, Field, Select } from "../ui";
import { useMe } from "../util";

/** Imagen redonda del PJ. Si `editable`, al pulsarla se sube otra. */
export function PjAvatar({ pj, editable, color = "#8a7bd0", size = "h-16 w-16 text-2xl" }: { pj: PjDto; editable: boolean; color?: string; size?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        disabled={!editable}
        onClick={() => input.current?.click()}
        className={`grid shrink-0 place-items-center overflow-hidden rounded-full border-2 font-bold disabled:cursor-default ${size}`}
        style={{ borderColor: color, background: color + "33" }}
        aria-label={editable ? "Cambiar imagen" : undefined}
      >
        {pj.imagen ? <img src={fileUrl(pj.imagen) as string} alt="" className="h-full w-full object-cover" /> : pj.nombre[0]?.toUpperCase()}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const up = await run(() => upload(f));
          if (up) await run(() => patch(`/api/pjs/${pj.id}`, { imagen: up.archivo }));
        }}
      />
    </>
  );
}

/** Edición libre, dueño y borrar. Solo para Narradores. */
export function NarratorPjControls({ pj, onDeleted, freeEditHint }: { pj: PjDto; onDeleted: () => void; freeEditHint?: string }) {
  const { snap, narrator } = useMe();
  if (!narrator) return null;
  return (
    <Card title="Ajustes del Narrador">
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={pj.edicionLibre} onChange={(e) => void run(() => patch(`/api/pjs/${pj.id}`, { edicionLibre: e.target.checked }))} />
          {freeEditHint ?? "Edición libre: el jugador edita su hoja como un Narrador"}
        </label>
        <Field label="Dueño">
          <Select value={pj.duenoId ?? ""} onChange={(e) => void run(() => patch(`/api/pjs/${pj.id}`, { duenoId: e.target.value || null }))}>
            <option value="">Sin dueño</option>
            {snap.usuarios.map((u) => (
              <option key={u.id} value={u.id}>{u.nombre} ({u.rol})</option>
            ))}
          </Select>
        </Field>
        <ConfirmButton variant="ghost" message="Eliminar personaje, ¿seguro?" onConfirm={async () => (await run(() => del(`/api/pjs/${pj.id}`))) && onDeleted()}>
          Eliminar personaje
        </ConfirmButton>
      </div>
    </Card>
  );
}
