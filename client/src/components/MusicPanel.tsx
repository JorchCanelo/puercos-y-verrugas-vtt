import { useState } from "react";
import { del, post, upload } from "../api";
import { run } from "../store";
import { Button, Card, ConfirmButton, Empty, Field, Input } from "../ui";
import { useMe } from "../util";

/** Biblioteca y control de la música (solo Narrador). Todos los clientes reproducen sincronizados desde el servidor. */
export function MusicPanel() {
  const { snap } = useMe();
  const m = snap.musica;
  const [nombre, setNombre] = useState("");
  const control = (body: object) => void run(() => post("/api/musica", body));

  return (
    <div className="space-y-4">
      <Card title="Sonando ahora">
        <p className="text-sm">{m.pista ? m.pista.nombre : <span className="text-muted">Nada.</span>} {m.pista && <span className="text-muted">· {m.reproduciendo ? "reproduciendo" : "en pausa"}</span>}</p>
        <div className="mt-2 flex gap-2">
          {m.reproduciendo ? <Button onClick={() => control({ accion: "pause" })}>⏸ Pausa</Button> : <Button variant="primary" disabled={!m.pistaId} onClick={() => control({ accion: "play" })}>▶ Reanudar</Button>}
          <Button disabled={!m.pistaId} onClick={() => control({ accion: "seek", posicionMs: 0 })}>⏮ Desde el inicio</Button>
          <Button disabled={!m.pistaId} onClick={() => control({ accion: "stop" })}>⏹ Detener</Button>
        </div>
        <p className="mt-2 text-xs text-muted">Los jugadores la oyen sincronizada si pulsan «Activar audio» (el navegador exige ese gesto).</p>
      </Card>

      {snap.playlists.length === 0 && <Empty>Crea una playlist y sube pistas de audio (MP3, OGG, WAV, FLAC o M4A).</Empty>}
      {snap.playlists.map((pl) => (
        <Card
          key={pl.id}
          title={pl.nombre}
          actions={
            <>
              <label className="cursor-pointer rounded-md border border-line bg-panel-2 px-2 py-1 text-xs hover:border-gold-dim">
                + Pista
                <input
                  type="file"
                  accept="audio/*"
                  hidden
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    const up = await run(() => upload(f));
                    if (up) await run(() => post(`/api/playlists/${pl.id}/pistas`, { nombre: f.name.replace(/\.[^.]+$/, ""), archivo: up.archivo }));
                  }}
                />
              </label>
              <ConfirmButton small variant="ghost" message="¿Borrar?" onConfirm={() => void run(() => del(`/api/playlists/${pl.id}`))}>Borrar</ConfirmButton>
            </>
          }
        >
          {pl.pistas.length === 0 && <p className="text-sm text-muted">Sin pistas.</p>}
          <ul className="divide-y divide-line">
            {pl.pistas.map((p) => (
              <li key={p.id} className="flex items-center gap-2 py-1.5">
                <Button small variant={m.pistaId === p.id ? "primary" : "subtle"} onClick={() => control({ accion: "play", pistaId: p.id })} aria-label={`Reproducir ${p.nombre}`}>▶</Button>
                <span className="flex-1 truncate text-sm">{p.nombre}</span>
                <Button small variant="ghost" onClick={() => void run(() => del(`/api/pistas/${p.id}`))} aria-label={`Quitar ${p.nombre}`}>✕</Button>
              </li>
            ))}
          </ul>
        </Card>
      ))}

      <Card title="Nueva playlist">
        <form className="flex items-end gap-2" onSubmit={async (e) => { e.preventDefault(); if (await run(() => post("/api/playlists", { nombre }))) setNombre(""); }}>
          <div className="flex-1"><Field label="Nombre"><Input value={nombre} onChange={(e) => setNombre(e.target.value)} /></Field></div>
          <Button type="submit" disabled={!nombre.trim()}>Crear</Button>
        </form>
      </Card>
    </div>
  );
}
