import { useEffect, useState } from "react";
import { admin, ApiError, post } from "./api";
import { connectSocket, disconnectSocket } from "./socket";
import { useStore } from "./store";
import { Toasts } from "./ui";
import AdminView from "./views/Admin";
import LoginView from "./views/Login";
import MesaView from "./views/Mesa";

type Mode = "checking" | "admin" | "login" | "mesa";

/**
 * Un mismo cliente sirve a dos listeners:
 *  · puerto público  → jugadores (login) y Narrador anfitrión (entra con ?hostToken=…)
 *  · puerto local    → panel del anfitrión (/admin-api existe solo aquí)
 */
export default function App() {
  const [mode, setMode] = useState<Mode>("checking");
  const snap = useStore((s) => s.snap);
  const refresh = useStore((s) => s.refresh);

  useEffect(() => {
    void (async () => {
      const url = new URL(window.location.href);
      const hostToken = url.searchParams.get("hostToken");
      if (hostToken) {
        window.history.replaceState({}, "", url.pathname); // el token no debe quedar en el historial
        try {
          await post("/api/auth/host-exchange", { token: hostToken });
        } catch (e) {
          useStore.getState().toast(e instanceof ApiError ? e.message : "No se pudo entrar como anfitrión");
        }
      }
      if (await refresh()) return setMode("mesa");
      try {
        await admin.ping();
        return setMode("admin");
      } catch {
        return setMode("login");
      }
    })();
  }, [refresh]);

  // Si la sesión desaparece (cierre de la Partida, logout), volver al login.
  useEffect(() => {
    if (mode === "mesa" && !snap) {
      disconnectSocket();
      setMode("login");
    }
  }, [snap, mode]);

  useEffect(() => {
    if (mode === "mesa") connectSocket();
  }, [mode]);

  const logout = async () => {
    await post("/api/auth/logout").catch(() => undefined);
    disconnectSocket();
    useStore.getState().reset();
    setMode("login");
  };

  return (
    <>
      {mode === "checking" && <p className="p-8 text-center text-muted">Cargando…</p>}
      {mode === "admin" && <AdminView />}
      {mode === "login" && (
        <LoginView
          onLoggedIn={async () => {
            if (await refresh()) setMode("mesa");
          }}
        />
      )}
      {mode === "mesa" && snap && <MesaView onLogout={logout} />}
      <Toasts />
    </>
  );
}

