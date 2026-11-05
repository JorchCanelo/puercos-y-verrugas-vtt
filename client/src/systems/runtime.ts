// Carga las interfaces de los módulos empaquetados (.pyvmod) que el servidor cargó al arrancar.
// Su código viene ya compilado (scripts/pack-module.mjs) sin React, zod, @pyv/shared ni el SDK: los toma de
// globalThis.__PYV_CLIENT__, así usa exactamente los mismos que este cliente (un solo React, mismas clases).
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as jsxRuntime from "react/jsx-runtime";
import * as zod from "zod";
import * as shared from "@pyv/shared";
import type { ModulosClienteDto } from "@pyv/shared";
import { get } from "../api";
import * as sdk from "../sdk";
import { registerUi } from "./registry";
import type { SystemUi } from "./types";

let loading: Promise<void> | null = null;

/** Se llama antes de mostrar la mesa (requiere sesión). Solo carga una vez; si falla la petición, se reintenta la próxima. */
export function loadPackedModules(): Promise<void> {
  loading ??= load().catch((e) => {
    console.warn("[módulos] No se pudo obtener la lista de módulos empaquetados", e);
    loading = null;
  });
  return loading;
}

async function load(): Promise<void> {
  const info = await get<ModulosClienteDto>("/api/modulos");
  if (!info.modulos.length) return;

  (globalThis as Record<string, unknown>).__PYV_CLIENT__ = {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "react-dom": ReactDOM,
    "@pyv/client/sdk": sdk,
    "@pyv/shared": shared,
    zod,
  };

  const styles = info.estilos ? loadStylesheet(info.estilos) : Promise.resolve();
  await Promise.all([
    styles,
    ...info.modulos.map(async (m) => {
      try {
        const mod = (await import(/* @vite-ignore */ m.url)) as { ui?: SystemUi };
        if (!mod.ui || mod.ui.id !== m.id || !mod.ui.SheetView) throw new Error(`no exporta una interfaz con id "${m.id}"`);
        registerUi(mod.ui);
      } catch (e) {
        // Sin interfaz, las Partidas de ese sistema se ven en solo lectura.
        console.error(`[módulos] No se pudo cargar la interfaz de "${m.id}"`, e);
      }
    }),
  ]);
}

/** Añade la hoja de estilos de los paquetes y espera a que cargue (máx. 5 s) para no mostrar la mesa sin estilos. */
function loadStylesheet(href: string): Promise<void> {
  return new Promise((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    const done = () => resolve();
    link.onload = done;
    link.onerror = () => (console.warn("[módulos] No se pudieron cargar los estilos de los módulos"), done());
    setTimeout(done, 5000);
    document.head.appendChild(link);
  });
}
