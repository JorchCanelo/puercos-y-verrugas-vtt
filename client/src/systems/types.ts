// Interfaz de usuario que aporta un sistema de juego (la parte con React; las reglas están en @pyv/shared).
// Todo es opcional salvo la hoja: el núcleo pone alternativas genéricas para lo que falte.
import type { ComponentType } from "react";
import type { PjDto, RollTone } from "@pyv/shared";

export interface SystemUi {
  /** Mismo id que el GameSystem de @pyv/shared. */
  id: string;

  /** Hoja completa del PJ (ver/editar). `onBack` vuelve a la lista. */
  SheetView: ComponentType<{ pj: PjDto; onBack: () => void }>;

  /** Asistente para crear un PJ. Sin él no se pueden crear PJs desde la interfaz. */
  CreationWizard?: ComponentType<{ onClose: () => void; onCreated: (pj: PjDto) => void }>;

  /** Línea de resumen bajo el nombre en la lista de PJs (p. ej. casa y curso). */
  PjSummary?: ComponentType<{ pj: PjDto }>;

  /** Aviso destacado en la lista de PJs (p. ej. "¡Progreso!"). */
  pjBadge?(pj: PjDto): string | null;

  /** Sección de movimientos en "Tiradas y chat". Sin ella solo hay dados libres. */
  MovesPanel?: ComponentType;

  /** Color de la ficha de un PJ en el tablero (por defecto, el del núcleo). */
  tokenColor?(pj: PjDto): string | null;

  /** Etiquetas de tiradas guardadas sin ellas (las anteriores al ciclo 4). */
  rollLabels?: {
    stat?(id: string): string | undefined;
    resultado?(id: string): { etiqueta: string; tono: RollTone } | undefined;
  };
}
