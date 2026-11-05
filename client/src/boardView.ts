// Vista local del tablero (zoom y desplazamiento). Cada usuario tiene la suya: no se sincroniza con el servidor.
// La vista se aplica al Stage de Konva encima del encaje "ajustar a la pantalla" de la escena, así que las
// coordenadas de las fichas (0..1 o casillas) no cambian.

export interface BoardView {
  /** Zoom relativo al encaje (1 = la escena completa cabe en pantalla). */
  zoom: number;
  /** Desplazamiento del Stage en píxeles de pantalla. */
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Rectángulo que ocupa la escena con zoom 1 (en píxeles de pantalla). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 5;
/** Factor por paso de rueda o botón. */
export const ZOOM_STEP = 1.2;
/** Píxeles de la escena que siempre quedan visibles al desplazar, para no perderla. */
export const KEEP_VISIBLE = 80;

export const FIT_VIEW: BoardView = { zoom: 1, x: 0, y: 0 };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Ajusta el desplazamiento para que al menos KEEP_VISIBLE px de la escena sigan en pantalla. */
export function clampPan(pos: Point, zoom: number, viewport: { w: number; h: number }, content: Rect): Point {
  const left = content.x * zoom; // borde izquierdo de la escena sin desplazar
  const right = (content.x + content.w) * zoom;
  const top = content.y * zoom;
  const bottom = (content.y + content.h) * zoom;
  const keepX = Math.min(KEEP_VISIBLE, (right - left) / 2);
  const keepY = Math.min(KEEP_VISIBLE, (bottom - top) / 2);
  return {
    x: clamp(pos.x, keepX - right, viewport.w - keepX - left),
    y: clamp(pos.y, keepY - bottom, viewport.h - keepY - top),
  };
}

/**
 * Cambia el zoom manteniendo fijo el punto `at` de la pantalla (cursor, centro del pellizco o centro del tablero).
 * `pan` desplaza además la vista (lo que se movió el centro del pellizco).
 */
export function zoomAt(
  view: BoardView,
  nextZoom: number,
  at: Point,
  viewport: { w: number; h: number },
  content: Rect,
  pan: Point = { x: 0, y: 0 },
): BoardView {
  const zoom = clamp(nextZoom, ZOOM_MIN, ZOOM_MAX);
  // Punto de la escena (en coordenadas del Stage sin transformar) que está bajo `at`.
  const sx = (at.x - view.x) / view.zoom;
  const sy = (at.y - view.y) / view.zoom;
  const pos = clampPan({ x: at.x - sx * zoom + pan.x, y: at.y - sy * zoom + pan.y }, zoom, viewport, content);
  return { zoom, ...pos };
}

export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
