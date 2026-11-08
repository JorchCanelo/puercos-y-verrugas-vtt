// Módulos empaquetados (.pyvmod): carga al arrancar, estados para el panel y estilos.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import { PYV_MODULE_API, createRegistry } from "@pyv/shared";
import { clientInfo, loadPacked, moduleStatus, parsePacked } from "../src/packed";
import { testSystem } from "./helpers";

const quiet = { log: () => undefined, warn: () => undefined };
const dirs: string[] = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "pyv-mod-"));
  dirs.push(d);
  return d;
}

/** Código de servidor como el que genera scripts/pack-module.mjs: usa @pyv/shared y zod del VTT. */
const serverCode = (id: string, nombre = "Dados de prueba") => `
const { defineSystem, patchOf } = globalThis.__PYV_SERVER__["@pyv/shared"];
const { z } = globalThis.__PYV_SERVER__["zod"];
const Sheet = z.object({ nombre: z.string().min(1), fuerza: z.number().int().default(1) });
export const system = defineSystem({
  id: ${JSON.stringify(id)}, nombre: ${JSON.stringify(nombre)}, version: "2.0.0",
  sheet: { schema: Sheet, patchSchema: patchOf(Sheet), empty: (nombre) => Sheet.parse({ nombre }), displayName: (s) => s.nombre, playerSafeKeys: ["fuerza"] },
});`;

function pack(id: string, extra: Record<string, unknown> = {}): Buffer {
  const manifest = {
    formato: 1,
    id,
    nombre: `Módulo ${id}`,
    version: "2.0.0",
    pyvApi: PYV_MODULE_API,
    servidor: serverCode(id),
    interfaz: `export const ui = { id: ${JSON.stringify(id)} };`,
    clases: ["grid-cols-7", "bg-gold/30"],
    ...extra,
  };
  return gzipSync(Buffer.from(JSON.stringify(manifest)));
}

describe("módulos empaquetados", () => {
  it("carga un .pyvmod: su sistema funciona con el zod y @pyv/shared del VTT", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "dados.pyvmod"), pack("dados"));
    const p = await loadPacked(dir, new Set(), quiet);
    assert.equal(p.systems.length, 1);
    const reg = createRegistry([testSystem, ...p.systems]);
    const sys = reg.get("dados");
    assert.ok(sys);
    assert.deepEqual(sys.sheet.schema.parse({ nombre: "Ana" }), { nombre: "Ana", fuerza: 1 });
    assert.deepEqual(p.arranque.map((x) => x.estado), ["cargado"]);
    const info = clientInfo(p);
    assert.equal(info.modulos.length, 1);
    assert.match(info.modulos[0]!.url, /^\/modulos\/dados\/[0-9a-f]{16}\.js$/);
    assert.match(info.estilos ?? "", /^\/modulos\/estilos\.css\?v=/);
  });

  it("los estilos incluyen las clases del paquete y las del cliente, con el tema del VTT", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "dados.pyvmod"), pack("dados"));
    const p = await loadPacked(dir, new Set(), quiet);
    const css = p.css?.text ?? "";
    assert.match(css, /\.grid-cols-7\s*\{/);
    assert.match(css, /\.bg-gold\\\/30/);
    assert.match(css, /--color-gold:/);
    assert.match(css, /\.text-muted\s*\{/); // clase del cliente
  });

  it("sin paquetes no hay nada que cargar ni estilos", async () => {
    const p = await loadPacked(join(tempDir(), "no-existe"), new Set(), quiet);
    assert.deepEqual(p.systems, []);
    assert.equal(p.css, null);
    assert.deepEqual(clientInfo(p), { estilos: null, modulos: [] });
  });

  it("archivos rotos, incompatibles o duplicados no impiden arrancar y quedan con su motivo", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "a-roto.pyvmod"), Buffer.from("no soy un gzip"));
    writeFileSync(join(dir, "b-viejo.pyvmod"), pack("viejo", { pyvApi: PYV_MODULE_API + 1 }));
    writeFileSync(join(dir, "c-fuente.pyvmod"), pack("prueba")); // ya está como código fuente
    writeFileSync(join(dir, "d-uno.pyvmod"), pack("dados"));
    writeFileSync(join(dir, "e-otro.pyvmod"), pack("dados"));
    writeFileSync(join(dir, "f-malo.pyvmod"), pack("malo", { servidor: "export const system = { id: 'otro' };" }));
    writeFileSync(join(dir, "g-generico.pyvmod"), pack("generico"));
    const p = await loadPacked(dir, new Set(["prueba"]), quiet);
    assert.deepEqual(
      p.arranque.map((x) => [x.archivo, x.estado]),
      [
        ["a-roto.pyvmod", "error"],
        ["b-viejo.pyvmod", "incompatible"],
        ["c-fuente.pyvmod", "duplicado"],
        ["d-uno.pyvmod", "cargado"],
        ["e-otro.pyvmod", "duplicado"],
        ["f-malo.pyvmod", "error"],
        ["g-generico.pyvmod", "incompatible"],
      ],
    );
    assert.deepEqual(p.systems.map((s) => s.id), ["dados"]);
  });

  it("el panel avisa de lo que cambia al reiniciar: nuevos, actualizados y quitados", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "dados.pyvmod"), pack("dados"));
    writeFileSync(join(dir, "cartas.pyvmod"), pack("cartas"));
    const p = await loadPacked(dir, new Set(), quiet);
    let s = moduleStatus(p, [testSystem]);
    assert.equal(s.reinicioPendiente, false);
    assert.deepEqual(s.modulos.map((m) => [m.origen, m.id, m.estado]), [
      ["codigo", "prueba", "cargado"],
      ["paquete", "cartas", "cargado"],
      ["paquete", "dados", "cargado"],
    ]);

    rmSync(join(dir, "cartas.pyvmod"));
    writeFileSync(join(dir, "dados.pyvmod"), pack("dados", { version: "3.0.0" }));
    writeFileSync(join(dir, "nuevo.pyvmod"), pack("nuevo"));
    s = moduleStatus(p, [testSystem]);
    assert.equal(s.reinicioPendiente, true);
    assert.deepEqual(
      s.modulos.filter((m) => m.origen === "paquete").map((m) => [m.id, m.version, m.estado]),
      [
        ["dados", "3.0.0", "actualizar"],
        ["nuevo", "2.0.0", "pendiente"],
        ["cartas", "2.0.0", "quitar"],
      ],
    );
  });

  it("parsePacked rechaza archivos que no son módulos", () => {
    assert.throws(() => parsePacked(Buffer.from("hola")), /No es un archivo de módulo/);
    assert.throws(() => parsePacked(gzipSync(Buffer.from(JSON.stringify({ formato: 1, id: "x" })))), /incompleto o dañado/);
    assert.throws(() => parsePacked(pack("Mayúsculas")), /incompleto o dañado/);
  });
});
