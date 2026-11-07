import { useState } from "react";
import type { UsuarioDto } from "@pyv/shared";
import { del, post, put } from "../api";
import { run, useStore } from "../store";
import { Button, Card, ConfirmButton, Field, Input, Modal, Select, cx } from "../ui";
import { isOnline, useMe } from "../util";

export function UsersPanel() {
  const { snap, me } = useMe();
  const [nombre, setNombre] = useState("");
  const [password, setPassword] = useState("");
  const [rol, setRol] = useState<"jugador" | "narrador">("jugador");
  const [changing, setChanging] = useState<UsuarioDto | null>(null);
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
              {/* Solo el Narrador anfitrión cambia contraseñas (él no tiene: entra desde el panel del anfitrión). */}
              {me.esAnfitrion && !u.esAnfitrion && (
                <Button small onClick={() => setChanging(u)}>Contraseña</Button>
              )}
              {!u.esAnfitrion && u.id !== me.id && (
                <ConfirmButton small variant="ghost" message="¿Eliminar?" onConfirm={() => void run(() => del(`/api/usuarios/${u.id}`))}>
                  Eliminar
                </ConfirmButton>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {changing && <PasswordDialog user={changing} onClose={() => setChanging(null)} />}
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

function PasswordDialog({ user, onClose }: { user: UsuarioDto; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const toast = useStore((s) => s.toast);
  return (
    <Modal title={`Nueva contraseña para ${user.nombre}`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => put(`/api/usuarios/${user.id}/password`, { password }))) {
            toast(`Contraseña de ${user.nombre} cambiada`, "ok");
            onClose();
          }
        }}
      >
        <Field label="Contraseña nueva" hint="Mínimo 4 caracteres. Si está conectado, se le cerrará la sesión y tendrá que entrar con la nueva.">
          <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} minLength={4} autoFocus required />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" type="submit" disabled={password.length < 4}>Cambiar</Button>
        </div>
      </form>
    </Modal>
  );
}
