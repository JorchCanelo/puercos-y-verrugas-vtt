import { useEffect, useState } from "react";
import { admin, ApiError, post } from "./api";
import { connectSocket, disconnectSocket } from "./socket";
import { useStore } from "./store";
import { loadPackedModules } from "./systems/runtime";
import { Toasts } from "./ui";
import AdminView from "./views/Admin";
import AdminLoginView from "./views/AdminLogin";
import LoginView from "./views/Login";
import MesaView from "./views/Mesa";

type Mode = "checking" | "admin" | "adminLogin" | "login" | "mesa";

const isAdminPath = () => window.location.pathname.replace(/\/+$/, "") === "/admin";

/**
 * Un mismo cliente sirve a dos listeners:
 *  · puerto público  → jugadores (login) y Narrador anfitrión (entra con ?hostToken=…)
 *  · puerto local    → panel del anfitrión (/admin-api existe solo aquí)
 * En MODO SERVIDOR hay un solo puerto: el panel del anfitrión está en /admin, tras una contraseña.
 */
export default function App() {
  const [mode, setMode] = useState<Mode>("checking");
  // Interfaces de los módulos empaquetados (.pyvmod): se cargan al entrar a la mesa, antes de mostrarla.
  const [modulesReady, setModulesReady] = useState(false);
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
      if (isAdminPath()) {
        try {
          const s = await admin.sesion();
          return setMode(s.autenticado ? "admin" : "adminLogin");
        } catch {
          /* sin panel en esta dirección: seguir como siempre */
        }
      }
      if (await refresh()) return setMode("mesa");
      try {
        const p = await admin.ping();
        // En modo servidor, la portada es para los jugadores aunque el navegador tenga sesión del panel.
        return setMode(p.servidor && !isAdminPath() ? "login" : "admin");
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
    if (mode !== "mesa") return;
    connectSocket();
    void loadPackedModules().then(() => setModulesReady(true));
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
      {mode === "admin" && (
        <AdminView
          onLogout={async () => {
            await admin.logout().catch(() => undefined);
            setMode("adminLogin");
          }}
        />
      )}
      {mode === "adminLogin" && <AdminLoginView onLoggedIn={() => setMode("admin")} />}
      {mode === "login" && (
        <LoginView
          onLoggedIn={async () => {
            if (await refresh()) setMode("mesa");
          }}
        />
      )}
      {mode === "mesa" && snap && !modulesReady && <p className="p-8 text-center text-muted">Cargando…</p>}
      {mode === "mesa" && snap && modulesReady && <MesaView onLogout={logout} />}
      <Toasts />
    </>
  );
}

