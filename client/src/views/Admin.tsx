import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SYSTEM_ID, type ModuloDto, type ModuloEstado, type ModulosDto, type PartidaDto, type SistemaInfoDto } from "@pyv/shared";
import { admin, type DatosInfo, type NetworkInfo } from "../api";
import { run, useStore } from "../store";
import { Button, Card, ConfirmButton, Empty, Field, Input, Select, Textarea, cx } from "../ui";
import { copyText, remember } from "../util";

export default function AdminView({ onLogout }: { onLogout?: () => void }) {
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
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl text-gold">Puercos y Verrugas VTT · Anfitrión</h1>
          <p className="text-muted">
            Crea Partidas, ábrelas para tus jugadores y entra como Narrador.{" "}
            {red?.servidor ? "Este panel está protegido con la contraseña del servidor." : "Este panel solo existe en tu computadora."}
          </p>
        </div>
        {red?.servidor && onLogout && (
          <Button variant="ghost" onClick={onLogout}>
            Cerrar sesión
          </Button>
        )}
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

      <ModulesCard servidor={!!red?.servidor} />

      <DataCard />

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
          {p.imagen ? <img src={`/admin-api/partidas/${p.id}/imagen?${p.imagen}`} alt="" className="h-full w-full object-cover" /> : "Añadir imagen"}
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

const ESTADO: Record<ModuloEstado, { label: string; cls: string }> = {
  cargado: { label: "Activo", cls: "bg-ok/20 text-ok" },
  pendiente: { label: "Se activará al reiniciar", cls: "bg-gold/15 text-gold" },
  actualizar: { label: "Se actualizará al reiniciar", cls: "bg-gold/15 text-gold" },
  quitar: { label: "Se quitará al reiniciar", cls: "bg-gold/15 text-gold" },
  incompatible: { label: "Incompatible", cls: "bg-danger/15 text-danger" },
  duplicado: { label: "Duplicado", cls: "bg-panel-2 text-muted" },
  error: { label: "Error", cls: "bg-danger/15 text-danger" },
};

/** Módulos de sistema de juego: los de modules/ (código fuente) y los paquetes .pyvmod, que se instalan aquí. */
function ModulesCard({ servidor }: { servidor: boolean }) {
  const [info, setInfo] = useState<ModulosDto | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useStore((s) => s.toast);
  useEffect(() => void run(() => admin.modulos()).then((r) => r && setInfo(r)), []);
  if (!info) return null;

  const install = async (f: File) => {
    setBusy(true);
    const r = await run(() => admin.instalarModulo(f));
    setBusy(false);
    if (r) {
      setInfo(r);
      toast("Módulo instalado: reinicia el VTT para activarlo", "ok");
    }
  };
  const remove = async (m: ModuloDto) => {
    const r = m.archivo && (await run(() => admin.quitarModulo(m.archivo as string)));
    if (r) setInfo(r);
  };

  return (
    <Card title="Módulos de sistema de juego">
      <div className="space-y-3 text-sm">
        <p className="text-muted">
          Un módulo añade las reglas de un juego (hoja de personaje, creación, tiradas…). Se instalan como archivos <code>.pyvmod</code>;
          también puedes copiarlos a mano a la carpeta <code className="break-all">{info.carpeta}</code>.
        </p>
        {info.reinicioPendiente && (
          <p className="rounded-md bg-gold/15 px-3 py-2 text-gold">
            {servidor
              ? "Hay cambios pendientes: reinicia el servidor (en «Datos de la mesa») para aplicarlos. Hazlo cuando no haya nadie jugando."
              : <>Hay cambios pendientes: cierra y vuelve a abrir el VTT (o reinicia <code>npm run play</code>) para aplicarlos. Hazlo cuando no haya nadie jugando.</>}
          </p>
        )}
        {info.modulos.length === 0 ? (
          <Empty>No hay módulos instalados: solo está el sistema genérico (hoja libre).</Empty>
        ) : (
          <ul className="space-y-2">
            {info.modulos.map((m) => {
              const e = ESTADO[m.estado];
              return (
                <li key={`${m.origen}:${m.archivo ?? m.id}:${m.estado}`} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-line bg-night/40 p-2.5">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{m.nombre}</span>
                      {m.version && <span className="text-xs text-muted">v{m.version}</span>}
                      <span className={cx("rounded-full px-2 py-0.5 text-xs", e.cls)}>{e.label}</span>
                    </div>
                    {m.detalle && <p className="text-xs text-muted">{m.detalle}</p>}
                    {m.archivo && <p className="break-all text-xs text-muted/80">{m.archivo}</p>}
                  </div>
                  {m.origen === "paquete" && m.archivo && m.estado !== "quitar" && (
                    <ConfirmButton
                      small
                      variant="ghost"
                      message="¿Quitar? Sus Partidas quedarán en solo lectura"
                      onConfirm={() => void remove(m)}
                    >
                      Quitar
                    </ConfirmButton>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? "Instalando…" : "Instalar módulo…"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".pyvmod"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void install(f);
            }}
          />
        </div>
        <p className="text-xs text-muted">
          Un módulo es código que se ejecuta en tu computadora y en el navegador de tus jugadores: instala solo módulos de quien confíes.
        </p>
      </div>
    </Card>
  );
}

function ShareCard({ red, onChange }: { red: NetworkInfo | null; onChange: (r: NetworkInfo) => void }) {
  const toast = useStore((s) => s.toast);
  if (!red) return null;
  const t = red.tunnel;
  const copy = async (url: string) => toast((await copyText(url)) ? "Enlace copiado" : "No se pudo copiar", "ok");
  if (red.servidor) {
    const url = red.servidor.url;
    return (
      <Card title="Compartir con tus jugadores">
        <div className="space-y-2 text-sm">
          <p className="text-muted">Tus jugadores entran desde esta dirección, desde cualquier lugar:</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-night/70 px-2 py-1">{url}</code>
            <Button small onClick={() => void copy(url)}>Copiar</Button>
          </div>
          <p className="text-xs text-muted">Este panel está en {url}/admin: no compartas esa dirección ni la contraseña.</p>
        </div>
      </Card>
    );
  }
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

const MB = 1024 * 1024;
const fmtBytes = (b: number) => (b >= 1024 * MB ? `${(b / 1024 / MB).toFixed(1)} GB` : `${Math.max(0.1, b / MB).toFixed(1)} MB`);
const linkBtn = "inline-block rounded-md border border-line bg-panel-2 px-3 py-2 text-sm transition hover:border-gold-dim";

/** Espacio usado, copia de los datos (descargar / restaurar) y, en modo servidor, reiniciar. */
function DataCard() {
  const [d, setD] = useState<DatosInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"subiendo" | "reiniciando" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useStore((s) => s.toast);
  useEffect(() => void run(() => admin.datos()).then((r) => r && setD(r)), []);
  if (!d) return null;

  const restore = async (f: File) => {
    setBusy("subiendo");
    const r = await run(() => admin.restaurar(f));
    setBusy(null);
    setFile(null);
    if (r) {
      setD(r);
      toast("Copia lista: se aplicará al reiniciar", "ok");
    }
  };

  const restart = async () => {
    setBusy("reiniciando");
    if (!(await run(() => admin.reiniciar()))) return setBusy(null);
    // Espera a que el servidor vuelva y recarga el panel.
    const started = Date.now();
    await new Promise((r) => setTimeout(r, 2000));
    for (;;) {
      try {
        await admin.ping();
        return window.location.reload();
      } catch {
        if (Date.now() - started > 120_000) {
          setBusy(null);
          return toast("El servidor tarda en volver; recarga la página en un momento", "error");
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  };

  return (
    <Card title="Datos de la mesa">
      <div className="space-y-4 text-sm">
        <p className="text-muted">
          Ocupan <span className="text-ink">{fmtBytes(d.bytes)}</span>
          {d.libre !== null && <> · libres en el disco: <span className="text-ink">{fmtBytes(d.libre)}</span></>}.
          {d.anterior > 0 && <> Incluye {fmtBytes(d.anterior)} de los datos de antes de la última restauración (carpeta <code>.anterior</code>; puedes borrarla a mano).</>}
        </p>

        <div className="space-y-2">
          <h3 className="font-semibold">Copia de los datos</h3>
          <p className="text-muted">
            Un solo archivo (<code>.pyvbak</code>) con todas las Partidas, personajes, archivos subidos y módulos. Sirve de respaldo y para llevar
            la mesa a otro lugar (de tu computadora a un servidor, o al revés).
          </p>
          <a className={linkBtn} href={admin.copiaUrl} download>
            Descargar copia
          </a>
        </div>

        <div className="space-y-2">
          <h3 className="font-semibold">Restaurar una copia</h3>
          <p className="text-muted">
            Sustituye <strong>todos</strong> los datos de esta mesa por los de la copia. Se aplica al reiniciar; los datos actuales se guardan en la
            carpeta <code>.anterior</code>.
          </p>
          {d.restauracionPendiente ? (
            <div className="space-y-2 rounded-md bg-gold/15 px-3 py-2 text-gold">
              <p>
                Hay una copia lista para restaurar.{" "}
                {d.puedeReiniciar ? "Reinicia el servidor para aplicarla." : "Cierra y vuelve a abrir el VTT (o reinicia npm run play) para aplicarla."}
              </p>
              <Button small variant="ghost" onClick={async () => { const r = await run(() => admin.cancelarRestauracion()); if (r) setD(r); }}>
                Descartar la copia preparada
              </Button>
            </div>
          ) : file ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="break-all">{file.name} · {fmtBytes(file.size)}</span>
              <ConfirmButton variant="primary" disabled={busy !== null} message="Se sustituirá todo, ¿seguro?" onConfirm={() => void restore(file)}>
                {busy === "subiendo" ? "Subiendo…" : "Preparar restauración"}
              </ConfirmButton>
              <Button variant="ghost" disabled={busy !== null} onClick={() => setFile(null)}>Cancelar</Button>
            </div>
          ) : (
            <Button onClick={() => fileRef.current?.click()}>Elegir copia…</Button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".pyvbak,application/gzip"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) setFile(f);
            }}
          />
          {d.servidor && (
            <p className="text-xs text-muted">
              Si la copia es muy grande para subirla por internet (Cloudflare admite hasta 100 MB por subida), ábrelo desde tu red local
              (http://IP-del-servidor:3000/admin) o copia el archivo a la carpeta de datos del servidor con el nombre <code>restaurar.pyvbak</code> y reinicia.
            </p>
          )}
        </div>

        {d.puedeReiniciar && (
          <div className="space-y-2">
            <h3 className="font-semibold">Reiniciar el servidor</h3>
            <p className="text-muted">Aplica módulos instalados y copias restauradas. Desconecta a todos unos segundos: hazlo cuando no haya nadie jugando.</p>
            <ConfirmButton disabled={busy !== null} message="¿Reiniciar ahora?" onConfirm={() => void restart()}>
              {busy === "reiniciando" ? "Reiniciando…" : "Reiniciar el servidor"}
            </ConfirmButton>
          </div>
        )}
      </div>
    </Card>
  );
}
