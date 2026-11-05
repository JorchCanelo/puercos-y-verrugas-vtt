import { create } from "zustand";
import type { FichaDto, MensajeDto, MusicDto, Snapshot, TiradaDto } from "@pyv/shared";
import { ApiError, get } from "./api";

export type Tab = "pjs" | "tiradas" | "materiales" | "musica" | "escenas" | "usuarios";

interface Toast {
  id: number;
  text: string;
  kind: "error" | "ok";
}

interface State {
  snap: Snapshot | null;
  /** Desfase (servidor − cliente) en ms, para sincronizar la música. */
  clockOffset: number;
  online: boolean;
  fatal: string | null;
  tab: Tab;
  selectedPjId: string | null;
  /** Escena que el Narrador está mirando (puede no ser la proyectada). */
  viewSceneId: string | null;
  toasts: Toast[];

  refresh(): Promise<boolean>;
  reset(): void;
  setTab(t: Tab): void;
  selectPj(id: string | null): void;
  viewScene(id: string | null): void;
  setOnline(b: boolean): void;
  setFatal(m: string | null): void;
  setClockOffset(ms: number): void;
  pushTirada(t: TiradaDto): void;
  pushMensaje(m: MensajeDto): void;
  patchFicha(f: FichaDto): void;
  setMusica(m: MusicDto): void;
  setConectados(ids: string[]): void;
  toast(text: string, kind?: Toast["kind"]): void;
  dismissToast(id: number): void;
}

let toastId = 1;

export const useStore = create<State>()((set, get_) => ({
  snap: null,
  clockOffset: 0,
  online: false,
  fatal: null,
  tab: "pjs",
  selectedPjId: null,
  viewSceneId: null,
  toasts: [],

  async refresh() {
    try {
      const snap = await get<Snapshot>("/api/state");
      set({ snap, clockOffset: snap.serverNow - Date.now() });
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) set({ snap: null });
      else get_().toast(e instanceof Error ? e.message : "No se pudo actualizar", "error");
      return false;
    }
  },
  reset: () => set({ snap: null, selectedPjId: null, viewSceneId: null, fatal: null, online: false }),
  setTab: (tab) => set({ tab }),
  selectPj: (selectedPjId) => set({ selectedPjId }),
  viewScene: (viewSceneId) => set({ viewSceneId }),
  setOnline: (online) => set({ online }),
  setFatal: (fatal) => set({ fatal }),
  setClockOffset: (clockOffset) => set({ clockOffset }),
  pushTirada: (t) =>
    set((s) =>
      !s.snap || s.snap.tiradas.some((x) => x.id === t.id) ? s : { snap: { ...s.snap, tiradas: [...s.snap.tiradas, t].slice(-200) } },
    ),
  pushMensaje: (m) =>
    set((s) =>
      !s.snap || s.snap.mensajes.some((x) => x.id === m.id) ? s : { snap: { ...s.snap, mensajes: [...s.snap.mensajes, m].slice(-200) } },
    ),
  patchFicha: (f) =>
    set((s) => (!s.snap ? s : { snap: { ...s.snap, fichas: s.snap.fichas.map((x) => (x.id === f.id ? f : x)) } })),
  setMusica: (musica) => set((s) => (s.snap ? { snap: { ...s.snap, musica } } : s)),
  setConectados: (conectados) => set((s) => (s.snap ? { snap: { ...s.snap, conectados } } : s)),
  toast(text, kind = "error") {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => get_().dismissToast(id), 5000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Ejecuta una acción async mostrando el error como aviso. Devuelve el resultado o undefined. */
export async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    useStore.getState().toast(e instanceof Error ? e.message : "Algo salió mal", "error");
    return undefined;
  }
}
