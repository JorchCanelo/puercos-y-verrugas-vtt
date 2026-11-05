import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SYSTEM_ID, type PartidaDto, type SistemaInfoDto } from "@pyv/shared";
import { admin, type NetworkInfo } from "../api";
import { run, useStore } from "../store";
import { Button, Card, ConfirmButton, Empty, Field, Input, Select, Textarea, cx } from "../ui";
import { copyText, remember } from "../util";

export default function AdminView() {
  const [partidas, setPartidas] = useState<PartidaDto[] | null>(null);
  const [red, setRed] = useState<NetworkInfo | null>(null);
  const [sistemas, setSistemas] = useState<SistemaInfoDto[]>([]);

  const load = useCallback(async () => {
    const [p, r, s] = await Promise.all([run(() => admin.partidas()), run(() => admin.red()), run(() => admin.sistemas())]);
    if (p) setPartidas(p);
    if (r) setRed(r);
    if (s) setSistemas(s);
  }, []);
  useEffect(() => void load(), [load]);

  // Mientras el túnel arranca, consulta su estado.
  useEffect(() => {
    if (red?.tunnel.estado !== "iniciando") return;
    const t = setInterval(() => void admin.red().then(setRed).catch(() => undefined), 1500);
    return () => clearInterval(t);
  }, [red?.tunnel.estado]);

  const enter = async (p: PartidaDto) => {
    // Se abre la ventana en el clic (los navegadores bloquean popups tras un await) y luego se le asigna la URL.
    const win = window.open("", "_blank");
    const r = await run(() => admin.entrar(p.id));
    if (!r) return void win?.close();
    if (win) win.location.href = r.url;
    else window.location.assign(r.url);
  };

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <header>
        <h1 className="text-3xl text-gold">Puercos y Verrugas VTT · Anfitrión</h1>
        <p className="text-muted">Crea Partidas, ábrelas para tus jugadores y entra como Narrador. Este panel solo existe en tu computadora.</p>
      </header>

      <NewPartida sistemas={sistemas} onCreated={load} />

      <section className="space-y-4">
        <h2 className="text-xl text-gold">Tus Partidas</h2>
        {partidas === null && <p className="text-muted">Cargando…</p>}
        {partidas?.length === 0 && <Empty>Aún no tienes Partidas. Crea la primera arriba.</Empty>}
        {partidas?.map((p) => (
          <PartidaCard key={p.id} p={p} sistemas={sistemas} onChange={load} onEnter={() => void enter(p)} />
        ))}
      </section>

      <ShareCard red={red} onChange={setRed} />
    </main>
  );
}

function NewPartida({ sistemas, onCreated }: { sistemas: SistemaInfoDto[]; onCreated: () => void }) {
  const [nombre, setNombre] = useState("");
  const [sistema, setSistema] = useState(DEFAULT_SYSTEM_ID);
  const [descripcion, setDescripcion] = useState("");
  const [anfitrionNombre, setAnfitrion] = useState(remember("vtt.host") ?? "");
  return (
    <Card title="Nueva Partida">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          remember("vtt.host", anfitrionNombre);
          if (await run(() => admin.crear({ nombre, descripcion, anfitrionNombre, sistema }))) {
            setNombre("");
            setDescripcion("");
            onCreated();
          }
        }}
      >
        <Field label="Nombre de la Partida">
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} required />
        </Field>
        <Field label="Tu nombre como Narrador" hint="Entrarás con este usuario sin contraseña.">
          <Input value={anfitrionNombre} onChange={(e) => setAnfitrion(e.target.value)} required />
        </Field>
        <Field label="Sistema de juego" hint="Reglas y hoja de personaje. Se puede cambiar mientras la Partida no tenga personajes.">
          <Select value={sistema} onChange={(e) => setSistema(e.target.value)}>
            {(sistemas.length ? sistemas : [{ id: DEFAULT_SYSTEM_ID, nombre: "Genérico (hoja libre)", version: "" }]).map((s) => (
              <option key={s.id} value={s.id}>{s.nombre}</option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Descripción">
            <Textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
          </Field>
        </div>
        <Button variant="primary" type="submit" disabled={!nombre || !anfitrionNombre} className="sm:col-span-2">
          Crear Partida
        </Button>
      </form>
    </Card>
  );
}

function PartidaCard({ p, sistemas, onChange, onEnter }: { p: PartidaDto; sistemas: SistemaInfoDto[]; onChange: () => void; onEnter: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {p.nombre}
          <span className={cx("rounded-full px-2 py-0.5 text-xs", p.activa ? "bg-ok/20 text-ok" : "bg-panel-2 text-muted")}>{p.activa ? "Abierta" : "Cerrada"}</span>
        </span>
      }
    >
      <div className="flex flex-col gap-4 sm:flex-row">
        <button
          className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed border-line bg-night/50 text-xs text-muted hover:border-gold-dim"
          onClick={() => fileRef.current?.click()}
          aria-label="Cambiar imagen de la Partida"
        >
          {p.imagen ? <img src={`/api/public/partidas/${p.id}/imagen?${p.imagen}`} alt="" className="h-full w-full object-cover" /> : "Añadir imagen"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f && (await run(() => admin.imagen(p.id, f)))) onChange();
          }}
        />
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-sm text-muted">{p.descripcion || "Sin descripción."}</p>
          {!p.imagen && p.activa && <p className="text-xs text-muted">Los jugadores ven la imagen al elegir Partida.</p>}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Sistema de juego:</span>
            {p.sistemaDisponible ? (
              <div className="w-64 max-w-full">
                <Select
                  value={p.sistema}
                  aria-label="Sistema de juego"
                  onChange={async (e) => (await run(() => admin.patch(p.id, { sistema: e.target.value }))) && onChange()}
                >
                  {sistemas.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </Select>
              </div>
            ) : (
              <span className="rounded bg-danger/15 px-2 py-0.5 text-danger">«{p.sistemaNombre}» no está instalado: personajes en solo lectura</span>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={p.edicionLibreDefault} onChange={async (e) => (await run(() => admin.patch(p.id, { edicionLibreDefault: e.target.checked }))) && onChange()} />
            Edición libre de hojas activada por defecto para PJs nuevos
          </label>
          <div className="flex flex-wrap gap-2">
            {p.activa ? (
              <>
                <Button variant="primary" onClick={onEnter}>Entrar como Narrador</Button>
                <Button onClick={async () => (await run(() => admin.desactivar(p.id))) && onChange()}>Cerrar Partida</Button>
              </>
            ) : (
              <Button variant="primary" onClick={async () => (await run(() => admin.activar(p.id))) && onChange()}>Abrir Partida</Button>
            )}
            <ConfirmButton variant="ghost" message="Borrar todo, ¿seguro?" onConfirm={async () => (await run(() => admin.borrar(p.id))) && onChange()}>
              Eliminar
            </ConfirmButton>
          </div>
        </div>
      </div>
    </Card>
  );
}

function ShareCard({ red, onChange }: { red: NetworkInfo | null; onChange: (r: NetworkInfo) => void }) {
  const toast = useStore((s) => s.toast);
  if (!red) return null;
  const t = red.tunnel;
  const copy = async (url: string) => toast((await copyText(url)) ? "Enlace copiado" : "No se pudo copiar", "ok");
  return (
    <Card title="Compartir con tus jugadores">
      <div className="space-y-4 text-sm">
        <div>
          <h3 className="mb-1 font-semibold">Por internet (túnel de Cloudflare)</h3>
          <p className="mb-2 text-muted">Genera un enlace https temporal; no hace falta abrir puertos en el router. El enlace cambia cada vez. Requiere instalar <code>cloudflared</code> (<code>winget install Cloudflare.cloudflared</code>).</p>
          {t.estado === "activo" && t.url ? (
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all rounded bg-night/70 px-2 py-1">{t.url}</code>
              <Button small onClick={() => void copy(t.url as string)}>Copiar</Button>
              <Button small variant="danger" onClick={async () => { const r = await run(() => admin.tunnelStop()); if (r) onChange({ ...red, tunnel: r }); }}>Detener</Button>
            </div>
          ) : (
            <Button disabled={t.estado === "iniciando"} onClick={async () => { onChange({ ...red, tunnel: { estado: "iniciando", url: null, error: null } }); const r = await run(() => admin.tunnelStart()); if (r) onChange({ ...red, tunnel: r }); }}>
              {t.estado === "iniciando" ? "Creando túnel…" : "Crear enlace para internet"}
            </Button>
          )}
          {t.error && <p className="mt-2 text-danger">{t.error}</p>}
        </div>
        <div>
          <h3 className="mb-1 font-semibold">En tu red local (mismo Wi-Fi)</h3>
          {red.lan.length === 0 ? (
            <p className="text-muted">No se detectó una red local.</p>
          ) : (
            <ul className="space-y-1">
              {red.lan.map((u) => (
                <li key={u} className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-night/70 px-2 py-1">{u}</code>
                  <Button small onClick={() => void copy(u)}>Copiar</Button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted">La primera vez, Windows pedirá permitir el acceso en el Firewall: acepta solo para redes privadas.</p>
        </div>
      </div>
    </Card>
  );
}
