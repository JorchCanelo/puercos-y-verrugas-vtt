// Empaqueta un módulo de modules/<carpeta> como archivo .pyvmod para la versión instalada del VTT (que no puede
// compilar módulos). Uso: npm run pack-module -- <carpeta>   →   release/modulos/<id>-<versión>.pyvmod
//
// El .pyvmod es un JSON comprimido con gzip (formato en shared/src/modules.ts) con:
//   - servidor: el GameSystem ("." del package.json) compilado a un solo ESM;
//   - interfaz: la SystemUi ("./ui") compilada a un solo ESM para el navegador;
//   - clases: las clases de Tailwind que usa el módulo (el servidor genera sus estilos al arrancar).
// React, zod, @pyv/shared y @pyv/client/sdk NO se meten en el paquete: los pone el VTT al cargarlo
// (globalThis.__PYV_SERVER__ / __PYV_CLIENT__), así el módulo usa exactamente los mismos que el VTT.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { extractCandidates } from "./lib/candidates.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/; // = MODULE_ID_RE de shared/src/modules.ts

const SERVER_GLOBALS = ["@pyv/shared", "zod"];
const CLIENT_GLOBALS = ["react", "react/jsx-runtime", "react-dom", "@pyv/client/sdk", "@pyv/shared", "zod"];

function fail(msg) {
  console.error(`[pack-module] ${msg}`);
  process.exit(1);
}

const folder = process.argv[2];
if (!folder) fail("Indica la carpeta del módulo: npm run pack-module -- <carpeta de modules/>");
const dir = join(root, "modules", folder);
const pkgFile = join(dir, "package.json");
if (!existsSync(pkgFile)) fail(`No existe modules/${folder}/package.json`);
const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
const id = pkg.pyv?.id;
if (!id || !ID_RE.test(id)) fail(`"pyv.id" falta o no es válido en modules/${folder}/package.json`);
if (id === "generico") fail(`"generico" es el sistema del VTT base; elige otro id`);
const serverEntry = pkg.exports?.["."];
const uiEntry = pkg.exports?.["./ui"];
if (typeof serverEntry !== "string" || typeof uiEntry !== "string") fail(`"exports" debe tener "." y "./ui" (rutas a archivos)`);
if (typeof pkg.version !== "string") fail(`Falta "version" en modules/${folder}/package.json`);

// Versión de la API de módulos del VTT con el que se empaqueta (PYV_MODULE_API en shared/src/modules.ts).
const apiMatch = /PYV_MODULE_API\s*=\s*(\d+)/.exec(readFileSync(join(root, "shared", "src", "modules.ts"), "utf8"));
if (!apiMatch) fail("No se encontró PYV_MODULE_API en shared/src/modules.ts");
const pyvApi = Number(apiMatch[1]);

/** Sustituye los imports de `names` por lo que el VTT deja en globalThis[holder] al cargar el módulo. */
const vttGlobals = (holder, names) => ({
  name: "pyv-globals",
  setup(b) {
    const filter = new RegExp(`^(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|")})$`);
    b.onResolve({ filter }, (a) => ({ path: a.path, namespace: "pyv-global" }));
    b.onLoad({ filter: /.*/, namespace: "pyv-global" }, (a) => ({
      contents: `const h = globalThis[${JSON.stringify(holder)}];\nif (!h) throw new Error("Este módulo solo se puede cargar desde Puercos y Verrugas VTT");\nmodule.exports = h[${JSON.stringify(a.path)}];`,
      loader: "js",
    }));
  },
});

async function bundle(entry, opts) {
  const result = await build({
    entryPoints: [join(dir, entry)],
    bundle: true,
    write: false,
    format: "esm",
    minify: true,
    legalComments: "none",
    logLevel: "warning",
    absWorkingDir: root,
    ...opts,
  });
  return result.outputFiles[0].text;
}

const servidor = await bundle(serverEntry, { platform: "node", target: "node22", plugins: [vttGlobals("__PYV_SERVER__", SERVER_GLOBALS)] });
const interfaz = await bundle(uiEntry, {
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  plugins: [vttGlobals("__PYV_CLIENT__", CLIENT_GLOBALS)],
});
// Un import que quede (de un paquete no incluido) haría fallar la carga en el navegador o en el servidor.
for (const [name, code] of [["servidor", servidor], ["interfaz", interfaz]]) {
  const left = [...code.matchAll(/(?:^|[;}\s])import\s*(?:[\w*{}\s,$]+from\s*)?["']([^"']+)["']/g)].map((m) => m[1]).filter((s) => !s.startsWith("node:"));
  if (left.length) fail(`La parte "${name}" aún importa ${[...new Set(left)].join(", ")}: inclúyelo en el módulo o pídelo al VTT`);
}

const manifest = {
  formato: 1,
  id,
  nombre: pkg.pyv?.nombre ?? id,
  version: pkg.version,
  descripcion: pkg.description ?? "",
  pyvApi,
  servidor,
  interfaz,
  clases: extractCandidates([join(dir, "src")]),
};

const outDir = join(root, "release", "modulos");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${id}-${pkg.version}.pyvmod`);
const data = gzipSync(Buffer.from(JSON.stringify(manifest), "utf8"), { level: 9 });
writeFileSync(outFile, data);
const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(
  `[pack-module] ${manifest.nombre} ${manifest.version} (API ${pyvApi}) → ${relative(root, outFile)} (${kb(data.length)}; servidor ${kb(servidor.length)}, interfaz ${kb(interfaz.length)}, ${manifest.clases.length} clases)`,
);
