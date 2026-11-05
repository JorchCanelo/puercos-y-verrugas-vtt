// Hoja de un PJ cuyo sistema de juego no está instalado: solo lectura, se muestra el contenido tal cual.
import type { PjDto } from "@pyv/shared";
import { Button, Card } from "../ui";
import { useMe, userName } from "../util";
import { PjAvatar } from "./PjCommon";

export function UnavailableSheet({ pj, onBack }: { pj: PjDto; onBack: () => void }) {
  const { snap, narrator } = useMe();
  return (
    <div className="space-y-3">
      <Button small variant="ghost" onClick={onBack}>← Volver</Button>
      <Card>
        <div className="flex items-center gap-3">
          <PjAvatar pj={pj} editable={false} />
          <div className="min-w-0">
            <h2 className="truncate text-xl text-gold">{pj.nombre}</h2>
            {narrator && <p className="mt-1 text-sm text-muted">de {userName(snap, pj.duenoId)}</p>}
          </div>
        </div>
      </Card>
      <SystemUnavailableNotice />
      <Card title="Contenido de la hoja">
        <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words text-xs text-muted">{JSON.stringify(pj.sheet, null, 2)}</pre>
      </Card>
    </div>
  );
}

export function SystemUnavailableNotice() {
  const { snap } = useMe();
  return (
    <p className="rounded-lg border border-danger/50 bg-danger/10 p-2.5 text-sm" role="note">
      El sistema de juego «{snap.partida.sistemaNombre}» no está instalado en este VTT. Los personajes se muestran en solo lectura: no se
      pueden crear, editar ni tirar sus movimientos. Sus datos se conservan intactos.
    </p>
  );
}
