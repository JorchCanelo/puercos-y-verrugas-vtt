import { useEffect, useRef, useState } from "react";
import Konva from "konva";
import { Circle, Group, Image as KImage, Layer, Line, Rect, Stage, Text } from "react-konva";
import type { EscenaDto, FichaDto } from "@pyv/shared";
import { FIT_VIEW, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, clampPan, dist, mid, zoomAt, type BoardView, type Point } from "../boardView";
import { fileUrl, patch, put } from "../api";
import { run, useStore } from "../store";
import { Button, Select } from "../ui";
import { useSystemUi } from "../systems/registry";
import { useMe } from "../util";

function useImg(url: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) return setImg(null);
    const i = new window.Image();
    i.onload = () => setImg(i);
    i.onerror = () => setImg(null);
    i.src = url;
    return () => {
      i.onload = null;
      i.onerror = null;
    };
  }, [url]);
  return img;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// Permite detectar el segundo dedo (pellizco) aunque el primero ya haya empezado a arrastrar.
Konva.hitOnDragEnabled = true;

/**
 * Tablero: una escena con fondo y fichas.
 *  · Escena "imagen": fichas libres, coordenadas 0..1 sobre la imagen.
 *  · Escena "cuadrícula": fichas encajadas en casillas (col, fila); el servidor impide dos fichas en la misma casilla.
 * El jugador ve solo la escena proyectada; el Narrador puede navegar entre las abiertas.
 * Zoom y desplazamiento son locales de cada usuario (ver boardView.ts):
 *  · PC: rueda del ratón (centrada en el cursor), botones + / − / Ajustar, y arrastrar el fondo para moverse.
 *  · Móvil: pellizco con dos dedos y arrastrar el fondo con un dedo. Arrastrar una ficha propia la mueve.
 */
export function Board() {
  const { snap, me, narrator } = useMe();
  const systemUi = useSystemUi();
  const pjTokenColor = (pjId: string) => {
    const pj = snap.pjs.find((p) => p.id === pjId);
    return (pj && systemUi?.tokenColor?.(pj)) || PJ_TOKEN_COLOR;
  };
  const viewSceneId = useStore((s) => s.viewSceneId);
  const viewScene = useStore((s) => s.viewScene);
  const patchFicha = useStore((s) => s.patchFicha);
  const refresh = useStore((s) => s.refresh);

  const sceneId = narrator ? (viewSceneId ?? snap.escenaProyectadaId ?? snap.escenas.find((e) => e.abierta)?.id ?? null) : snap.escenaProyectadaId;
  const escena = snap.escenas.find((e) => e.id === sceneId) ?? null;
  const bg = useImg(fileUrl(escena?.imagen));

  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 320, h: 320 });
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setSize({ w: Math.max(50, entry.contentRect.width), h: Math.max(50, entry.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const iw = bg?.naturalWidth || 1600;
  const ih = bg?.naturalHeight || 1000;
  const scale = Math.min(size.w / iw, size.h / ih);
  const offX = (size.w - iw * scale) / 2;
  const offY = (size.h - ih * scale) / 2;

  // --- zoom y desplazamiento (vista local) -----------------------------------------
  const content = { x: offX, y: offY, w: iw * scale, h: ih * scale };
  const [view, setView] = useState<BoardView>(FIT_VIEW);
  const viewRef = useRef(view);
  viewRef.current = view;
  const pinch = useRef<{ center: Point; dist: number } | null>(null);

  // Al cambiar de escena (o proyectar otra) se vuelve a ver completa.
  useEffect(() => setView(FIT_VIEW), [escena?.id]);

  const zoomBy = (factor: number, at: Point = { x: size.w / 2, y: size.h / 2 }) =>
    setView((v) => zoomAt(v, v.zoom * factor, at, size, content));

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const at = e.target.getStage()?.getPointerPosition();
    if (!at || e.evt.deltaY === 0) return;
    // Trackpads envían muchos eventos pequeños: el factor depende de la intensidad (con tope).
    const steps = clamp(Math.abs(e.evt.deltaY) / 100, 0.1, 1);
    zoomBy(e.evt.deltaY < 0 ? ZOOM_STEP ** steps : 1 / ZOOM_STEP ** steps, at);
  };

  const touchPoints = (e: Konva.KonvaEventObject<TouchEvent>): [Point, Point] | null => {
    const t1 = e.evt.touches[0];
    const t2 = e.evt.touches[1];
    const box = e.target.getStage()?.container().getBoundingClientRect();
    if (!t1 || !t2 || !box) return null;
    return [
      { x: t1.clientX - box.left, y: t1.clientY - box.top },
      { x: t2.clientX - box.left, y: t2.clientY - box.top },
    ];
  };

  // Al apoyar el segundo dedo se toma la referencia del pellizco (así no se pierde el primer movimiento).
  const onTouchStart = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const pts = touchPoints(e);
    if (pts) pinch.current = { center: mid(pts[0], pts[1]), dist: dist(pts[0], pts[1]) };
  };

  const onTouchMove = (e: Konva.KonvaEventObject<TouchEvent>) => {
    const pts = touchPoints(e);
    if (!pts) return;
    e.evt.preventDefault();
    const stage = e.target.getStage();
    if (stage?.isDragging()) stage.stopDrag(); // el pellizco manda sobre el arrastre del fondo
    const center = mid(pts[0], pts[1]);
    const d = dist(pts[0], pts[1]);
    const prev = pinch.current;
    pinch.current = { center, dist: d };
    if (!prev || prev.dist === 0) return;
    const v = viewRef.current;
    const pan = { x: center.x - prev.center.x, y: center.y - prev.center.y };
    setView(zoomAt(v, v.zoom * (d / prev.dist), prev.center, size, content, pan));
  };

  // Al levantar un dedo termina el pellizco (si quedan dos, el siguiente movimiento retoma la referencia).
  const onTouchEnd = (e: Konva.KonvaEventObject<TouchEvent>) => {
    pinch.current = null;
    if (e.evt.touches.length >= 2) onTouchStart(e);
  };

  const myPjIds = new Set(snap.pjs.filter((p) => p.duenoId === me.id).map((p) => p.id));
  const fichas = escena ? snap.fichas.filter((f) => f.escenaId === escena.id) : [];

  const move = async (f: FichaDto, x: number, y: number) => {
    if (x === f.x && y === f.y) return;
    patchFicha({ ...f, x, y }); // optimista; si el servidor lo rechaza, se vuelve a la posición real
    const ok = await run(() => patch<FichaDto>(`/api/fichas/${f.id}`, { x, y }));
    if (!ok) await refresh();
  };

  const project = (id: string | null) => run(() => put("/api/proyeccion", { escenaId: id }));
  const openScenes = snap.escenas.filter((e) => e.abierta || e.id === escena?.id);

  return (
    <div className="relative h-full w-full bg-black/30" ref={wrap} style={{ touchAction: "none" }}>
      <div className="absolute left-2 top-2 z-10 flex max-w-[calc(100%-1rem)] items-center gap-2">
        {narrator ? (
          <>
            <Select aria-label="Escena que estás viendo" value={escena?.id ?? ""} onChange={(e) => viewScene(e.target.value || null)} className="w-auto max-w-48 bg-night/80">
              {openScenes.length === 0 && <option value="">Sin escenas abiertas</option>}
              {openScenes.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.id === snap.escenaProyectadaId ? "📺 " : ""}
                  {e.nombre}
                </option>
              ))}
            </Select>
            {escena && escena.id !== snap.escenaProyectadaId && (
              <Button small variant="primary" onClick={() => void project(escena.id)}>
                Proyectar
              </Button>
            )}
            {snap.escenaProyectadaId && (
              <Button small onClick={() => void project(null)}>
                Apagar
              </Button>
            )}
          </>
        ) : (
          escena && <span className="rounded bg-night/70 px-2 py-1 font-display text-sm text-gold">{escena.nombre}</span>
        )}
      </div>

      {!escena ? (
        <div className="grid h-full place-items-center p-6 text-center text-muted">
          {narrator ? "Crea una escena en la pestaña «Escenas» y proyéctala." : "El Narrador aún no ha proyectado ninguna escena."}
        </div>
      ) : (
        <Stage
          width={size.w}
          height={size.h}
          x={view.x}
          y={view.y}
          scaleX={view.zoom}
          scaleY={view.zoom}
          draggable
          dragBoundFunc={(pos) => clampPan(pos, viewRef.current.zoom, size, content)}
          onDragMove={(e) => {
            if (e.target === e.target.getStage()) setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }));
          }}
          onDragEnd={(e) => {
            if (e.target === e.target.getStage()) setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }));
          }}
          onWheel={onWheel}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
        >
          <Layer x={offX} y={offY} scaleX={scale} scaleY={scale}>
            {bg ? <KImage image={bg} width={iw} height={ih} /> : <Rect width={iw} height={ih} fill="#1a2040" />}
            {escena.tipo === "cuadricula" && <GridLines escena={escena} iw={iw} ih={ih} />}
            {fichas.map((f) => (
              <Token
                key={f.id}
                f={f}
                escena={escena}
                iw={iw}
                ih={ih}
                canMove={narrator || (f.ref.tipo === "pj" && myPjIds.has(f.ref.id))}
                color={f.ref.tipo === "pj" ? pjTokenColor(f.ref.id) : NPC_TOKEN_COLOR}
                onMove={move}
              />
            ))}
          </Layer>
        </Stage>
      )}

      {escena && (
        <div className="absolute bottom-2 right-2 z-10 flex items-center gap-1 rounded-lg bg-night/80 p-1 shadow" role="group" aria-label="Zoom del tablero">
          <Button small aria-label="Alejar" title="Alejar" disabled={view.zoom <= ZOOM_MIN} onClick={() => zoomBy(1 / ZOOM_STEP)}>
            −
          </Button>
          <span className="min-w-12 text-center font-mono text-xs text-muted" aria-live="polite">
            {Math.round(view.zoom * 100)}%
          </span>
          <Button small aria-label="Acercar" title="Acercar" disabled={view.zoom >= ZOOM_MAX} onClick={() => zoomBy(ZOOM_STEP)}>
            +
          </Button>
          <Button small aria-label="Ajustar la escena a la pantalla" title="Ver la escena completa" onClick={() => setView(FIT_VIEW)}>
            Ajustar
          </Button>
        </div>
      )}
    </div>
  );
}

const PJ_TOKEN_COLOR = "#8a7bd0";
const NPC_TOKEN_COLOR = "#6b7280";

function GridLines({ escena, iw, ih }: { escena: EscenaDto; iw: number; ih: number }) {
  const cw = iw / escena.columnas;
  const ch = ih / escena.filas;
  const lines = [];
  for (let c = 0; c <= escena.columnas; c++) lines.push(<Line key={`c${c}`} points={[c * cw, 0, c * cw, ih]} stroke="rgba(255,255,255,0.35)" strokeWidth={1} strokeScaleEnabled={false} listening={false} />);
  for (let r = 0; r <= escena.filas; r++) lines.push(<Line key={`r${r}`} points={[0, r * ch, iw, r * ch]} stroke="rgba(255,255,255,0.35)" strokeWidth={1} strokeScaleEnabled={false} listening={false} />);
  return <>{lines}</>;
}

function Token({ f, escena, iw, ih, canMove, color, onMove }: { f: FichaDto; escena: EscenaDto; iw: number; ih: number; canMove: boolean; color: string; onMove: (f: FichaDto, x: number, y: number) => void }) {
  const img = useImg(fileUrl(f.imagen));
  const grid = escena.tipo === "cuadricula";
  const cw = iw / escena.columnas;
  const ch = ih / escena.filas;
  const r = grid ? Math.min(cw, ch) * 0.42 : Math.min(iw, ih) * 0.035;
  const px = grid ? (f.x + 0.5) * cw : f.x * iw;
  const py = grid ? (f.y + 0.5) * ch : f.y * ih;
  const fontSize = Math.max(10, r * 0.5);

  return (
    <Group
      x={px}
      y={py}
      draggable={canMove}
      opacity={f.oculta ? 0.45 : 1}
      onDragEnd={(e) => {
        const node = e.target;
        if (grid) {
          const col = clamp(Math.floor(node.x() / cw), 0, escena.columnas - 1);
          const row = clamp(Math.floor(node.y() / ch), 0, escena.filas - 1);
          node.position({ x: (col + 0.5) * cw, y: (row + 0.5) * ch }); // encaja en la casilla
          onMove(f, col, row);
        } else {
          const x = clamp(node.x() / iw, 0, 1);
          const y = clamp(node.y() / ih, 0, 1);
          node.position({ x: x * iw, y: y * ih });
          onMove(f, x, y);
        }
      }}
    >
      <Circle radius={r} fill={color} stroke={f.oculta ? "#ffffff" : "#0d1020"} strokeWidth={r * 0.1} dash={f.oculta ? [r * 0.3, r * 0.2] : undefined} />
      {img ? (
        <Group clipFunc={(ctx) => ctx.arc(0, 0, r * 0.92, 0, Math.PI * 2, false)}>
          <KImage image={img} x={-r} y={-r} width={r * 2} height={r * 2} />
        </Group>
      ) : (
        <Text text={(f.nombre[0] ?? "?").toUpperCase()} x={-r} y={-fontSize * 0.6} width={r * 2} align="center" fontSize={fontSize * 1.3} fontStyle="bold" fill="#ffffff" listening={false} />
      )}
      <Text text={f.nombre} x={-r * 2.2} y={r + 2} width={r * 4.4} align="center" fontSize={fontSize} fill="#f4efe0" shadowColor="#000" shadowBlur={4} shadowOpacity={0.9} listening={false} />
    </Group>
  );
}
