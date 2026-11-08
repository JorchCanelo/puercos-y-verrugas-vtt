import { useState } from "react";
import { admin } from "../api";
import { run } from "../store";
import { Button, Card, Field, Input } from "../ui";

/** Modo servidor: contraseña del panel del anfitrión (VTT_ADMIN_PASSWORD). */
export default function AdminLoginView({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="mx-auto max-w-md space-y-6 px-4 py-12">
      <header className="space-y-1 text-center">
        <h1 className="text-3xl text-gold">Puercos y Verrugas VTT</h1>
        <p className="text-muted">Panel del anfitrión</p>
      </header>
      <Card>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const ok = await run(() => admin.login(password));
            setBusy(false);
            if (ok) {
              setPassword("");
              onLoggedIn();
            }
          }}
        >
          <Field label="Contraseña del panel" hint="La que configuraste en VTT_ADMIN_PASSWORD al montar el servidor.">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          </Field>
          <Button variant="primary" type="submit" disabled={busy || !password} className="w-full">
            {busy ? "Entrando…" : "Entrar"}
          </Button>
        </form>
      </Card>
      <p className="text-center text-sm text-muted">
        ¿Vienes a jugar? <a className="text-gold underline" href="/">Entra a la mesa</a>.
      </p>
    </main>
  );
}
