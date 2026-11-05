import { AudioBar } from "../components/AudioBar";
import { Board } from "../components/Board";
import { MaterialsPanel } from "../components/Materials";
import { MusicPanel } from "../components/MusicPanel";
import { PjsPanel } from "../components/PjsPanel";
import { RollsPanel } from "../components/RollsPanel";
import { ScenesPanel } from "../components/ScenesPanel";
import { UsersPanel } from "../components/UsersPanel";
import { useStore, type Tab } from "../store";
import { Button, cx } from "../ui";
import { useMe } from "../util";


export default function MesaView({ onLogout }: { onLogout: () => void }) {
  const { snap, me, narrator } = useMe();
  const { tab, setTab, online, fatal } = useStore();

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "pjs", label: narrator ? "Personajes" : "Mis PJs", show: true },
    { id: "tiradas", label: "Tiradas y chat", show: true },
    { id: "materiales", label: "Materiales", show: true },
    { id: "musica", label: "Música", show: narrator },
    { id: "escenas", label: "Escenas", show: narrator },
    { id: "usuarios", label: "Usuarios", show: narrator },
  ];
  const visible = tabs.filter((t) => t.show);
  const current = visible.some((t) => t.id === tab) ? tab : "pjs";
  const players = snap.usuarios.filter((u) => u.rol === "jugador" && snap.conectados.includes(u.id)).length;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-panel/80 px-3 py-2">
        <h1 className="truncate text-lg text-gold">{snap.partida.nombre}</h1>
        <span className="text-sm text-muted">
          {me.nombre} · {narrator ? "Narrador" : "Jugador"}
        </span>
        {/* Estado + audio + Salir: en el celular comparten una sola línea para dejar más espacio a la escena. */}
        <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1 sm:gap-4">
          <span className={cx("min-w-0 truncate text-xs", online ? "text-ok" : "text-danger")} role="status">
            {online ? `● En línea · ${players} jugador${players === 1 ? "" : "es"}` : "● Reconectando…"}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            <AudioBar />
            <Button small variant="ghost" onClick={onLogout}>
              Salir
            </Button>
          </div>
        </div>
      </header>

      {fatal && <p className="bg-danger/20 px-3 py-2 text-sm" role="alert">{fatal}</p>}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="h-[42dvh] shrink-0 lg:h-auto lg:min-w-0 lg:flex-1">
          <Board />
        </main>
        <aside className="flex min-h-0 flex-1 flex-col border-t border-line lg:w-[28rem] lg:flex-none lg:border-l lg:border-t-0 xl:w-[32rem]">
          <nav className="flex overflow-x-auto border-b border-line bg-panel/60" role="tablist">
            {visible.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={current === t.id}
                onClick={() => setTab(t.id)}
                className={cx("whitespace-nowrap px-3 py-2 text-sm transition", current === t.id ? "border-b-2 border-gold text-gold" : "text-muted hover:text-ink")}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto p-3" role="tabpanel">
            {current === "pjs" && <PjsPanel />}
            {current === "tiradas" && <RollsPanel />}
            {current === "materiales" && <MaterialsPanel />}
            {current === "musica" && narrator && <MusicPanel />}
            {current === "escenas" && narrator && <ScenesPanel />}
            {current === "usuarios" && narrator && <UsersPanel />}
          </div>
        </aside>
      </div>
    </div>
  );
}
