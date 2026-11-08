// Botones de la ficha de un PJ o NPC en la escena del tablero, dentro de su fila de la lista:
//  · Sin ficha: 📍 la pone (también se puede arrastrar la fila al tablero).
//  · Con ficha: ➡️ la quita y, solo para el Narrador, «Ocultar» / «Revelar» (ocultar es por ficha).
// Si no hay escena o no puede manejarla, no muestra nada (así todas las filas quedan iguales).
import { del, patch } from "../api";
import { run } from "../store";
import { canHandle, placeToken, tokenIn, useBoardScene, type TokenRef } from "../tokens";
import { Button } from "../ui";
import { useMe } from "../util";

export function TokenControls({ tokenRef, nombre }: { tokenRef: TokenRef; nombre: string }) {
  const { snap, me, narrator } = useMe();
  const escena = useBoardScene();
  if (!escena || !canHandle(snap, me, escena, tokenRef)) return null;
  const ficha = tokenIn(snap, escena, tokenRef);
  if (!ficha)
    return (
      <Button small title={`Poner a ${nombre} en «${escena.nombre}»`} aria-label={`Poner a ${nombre} en la escena`} onClick={() => void placeToken(snap, escena, tokenRef)}>
        📍
      </Button>
    );
  return (
    <>
      {narrator && (
        <Button small onClick={() => void run(() => patch(`/api/fichas/${ficha.id}`, { oculta: !ficha.oculta }))} title={ficha.oculta ? "Los jugadores no ven su ficha" : "Los jugadores ven su ficha"}>
          {ficha.oculta ? "Revelar" : "Ocultar"}
        </Button>
      )}
      <Button small title={`Quitar a ${nombre} de «${escena.nombre}»`} aria-label={`Quitar a ${nombre} de la escena`} onClick={() => void run(() => del(`/api/fichas/${ficha.id}`))}>
        ➡️
      </Button>
    </>
  );
}

/** ¿Su ficha en la escena del tablero está oculta? (para atenuar la fila). */
export function useTokenHidden(tokenRef: TokenRef): boolean {
  const { snap } = useMe();
  const escena = useBoardScene();
  return tokenIn(snap, escena, tokenRef)?.oculta ?? false;
}
