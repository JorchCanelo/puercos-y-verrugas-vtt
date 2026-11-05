import { useState } from "react";
import { del, post } from "../api";
import { run } from "../store";
import { Button, Card, ConfirmButton, Field, Input, Select, cx } from "../ui";
import { isOnline, useMe } from "../util";

export function UsersPanel() {
  const { snap, me } = useMe();
  const [nombre, setNombre] = useState("");
  const [password, setPassword] = useState("");
  const [rol, setRol] = useState<"jugador" | "narrador">("jugador");
  return (
    <div className="space-y-4">
      <Card title="Usuarios de la Partida">
        <ul className="divide-y divide-line">
          {snap.usuarios.map((u) => (
            <li key={u.id} className="flex items-center gap-2 py-2">
              <span className={cx("h-2.5 w-2.5 rounded-full", isOnline(snap, u) ? "bg-ok" : "bg-line")} title={isOnline(snap, u) ? "Conectado" : "Desconectado"} />
              <span className="flex-1 truncate text-sm">
                {u.nombre} <span className="text-xs text-muted">· {u.rol}{u.esAnfitrion && " · anfitrión"}</span>
              </span>
              {!u.esAnfitrion && u.id !== me.id && (
                <ConfirmButton small variant="ghost" message="¿Eliminar?" onConfirm={() => void run(() => del(`/api/usuarios/${u.id}`))}>
                  Eliminar
                </ConfirmButton>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Nuevo usuario">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => post("/api/usuarios", { nombre, password, rol }))) {
              setNombre("");
              setPassword("");
            }
          }}
        >
          <Field label="Nombre de usuario"><Input value={nombre} onChange={(e) => setNombre(e.target.value)} required /></Field>
          <Field label="Contraseña" hint="Mínimo 4 caracteres. Compártela con la persona por un canal privado."><Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} minLength={4} required /></Field>
          <Field label="Rol">
            <Select value={rol} onChange={(e) => setRol(e.target.value as typeof rol)}>
              <option value="jugador">Jugador</option>
              <option value="narrador">Narrador</option>
            </Select>
          </Field>
          <Button variant="primary" type="submit" disabled={!nombre.trim() || password.length < 4}>Crear usuario</Button>
        </form>
      </Card>
    </div>
  );
}
