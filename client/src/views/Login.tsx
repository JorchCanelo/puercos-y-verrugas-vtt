import { useEffect, useState } from "react";
import { get, post } from "../api";
import { run } from "../store";
import { Button, Card, Empty, Field, Input } from "../ui";
import { remember } from "../util";

interface PublicPartida {
  id: string;
  nombre: string;
  descripcion: string;
  imagen: string | null;
}

export default function LoginView({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [partidas, setPartidas] = useState<PublicPartida[] | null>(null);
  const [selected, setSelected] = useState<PublicPartida | null>(null);
  const [nombre, setNombre] = useState(remember("vtt.user") ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void get<PublicPartida[]>("/api/public/partidas")
      .then((p) => {
        setPartidas(p);
        if (p.length === 1) setSelected(p[0] ?? null);
      })
      .catch(() => setPartidas([]));
  }, []);

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    const ok = await run(() => post("/api/auth/login", { partidaId: selected.id, nombre, password }));
    setBusy(false);
    if (ok) {
      remember("vtt.user", nombre);
      onLoggedIn();
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-4 py-10">
      <header className="text-center">
        <h1 className="text-3xl text-gold sm:text-4xl">Puercos y Verrugas VTT</h1>
        <p className="mt-1 text-muted">Mesa virtual de rol</p>
      </header>

      {partidas === null && <p className="text-center text-muted">Buscando partidas abiertas…</p>}
      {partidas?.length === 0 && <Empty>No hay ninguna Partida abierta. Pide a tu anfitrión que la abra y te comparta el enlace.</Empty>}

      {partidas && partidas.length > 0 && !selected && (
        <ul className="grid gap-3">
          {partidas.map((p) => (
            <li key={p.id}>
              <button onClick={() => setSelected(p)} className="flex w-full items-center gap-3 rounded-xl border border-line bg-panel p-3 text-left transition hover:border-gold-dim">
                {p.imagen ? (
                  <img src={`/api/public/partidas/${p.id}/imagen`} alt="" className="h-16 w-16 rounded-lg object-cover" />
                ) : (
                  <div className="grid h-16 w-16 place-items-center rounded-lg bg-panel-2 text-2xl">🏰</div>
                )}
                <span>
                  <span className="block font-display text-lg text-gold">{p.nombre}</span>
                  <span className="line-clamp-2 text-sm text-muted">{p.descripcion}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <Card
          title={selected.nombre}
          actions={partidas && partidas.length > 1 ? <Button small variant="ghost" onClick={() => setSelected(null)}>Cambiar</Button> : undefined}
        >
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Field label="Usuario">
              <Input autoFocus autoComplete="username" value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </Field>
            <Field label="Contraseña">
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Button variant="primary" className="w-full" disabled={busy || !nombre || !password} type="submit">
              {busy ? "Entrando…" : "Entrar"}
            </Button>
          </form>
        </Card>
      )}
    </main>
  );
}
