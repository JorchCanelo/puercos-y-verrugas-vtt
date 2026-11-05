// Descubre los módulos de sistema de juego instalados en modules/* y genera los registros que importan
// el servidor y el cliente. Se ejecuta solo (postinstall, predev, prebuild, pretypecheck, pretest); también: npm run modules.
//
// Un módulo es una carpeta modules/<nombre>/ con un package.json que:
//   - tiene "pyv": { "id": "<id-del-sistema>" }
//   - exporta "." con `export const system: GameSystem` y "./ui" con `export const ui: SystemUi`.
// Los archivos generados están en .gitignore: el VTT base compila igual sin ningún módulo.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractCandidates } from "./lib/candidates.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const modulesDir = join(root, "modules");
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/; // = MODULE_ID_RE de shared/src/modules.ts

// --base: compilar sin los módulos de modules/ (lo usa `npm run dist`: el instalador lleva solo el VTT base;
// los módulos se instalan después como .pyvmod). El siguiente dev/build/play los vuelve a incluir.
const baseOnly = process.argv.includes("--base");

const found = [];
if (!baseOnly && existsSync(modulesDir)) {
  for (const entry of readdirSync(modulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgFile = join(modulesDir, entry.name, "package.json");
    if (!existsSync(pkgFile)) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
    } catch (e) {
      console.warn(`[módulos] modules/${entry.name}/package.json no es JSON válido; se ignora (${e.message})`);
      continue;
    }
    const id = pkg.pyv?.id;
    if (!id) continue;
    if (!ID_RE.test(id)) {
      console.warn(`[módulos] modules/${entry.name}: id de sistema no válido "${id}"; se ignora`);
      continue;
    }
    if (typeof pkg.name !== "string" || !pkg.exports?.["."] || !pkg.exports?.["./ui"]) {
      console.warn(`[módulos] modules/${entry.name}: faltan "name" o "exports" ("." y "./ui"); se ignora`);
      continue;
    }
    if (found.some((m) => m.id === id)) {
      console.warn(`[módulos] modules/${entry.name}: el id "${id}" ya lo usa otro módulo; se ignora`);
      continue;
    }
    found.push({ id, name: pkg.name, dir: entry.name });
  }
}
found.sort((a, b) => a.id.localeCompare(b.id));

const banner = (what) =>
  `// ARCHIVO GENERADO por scripts/modules.mjs a partir de modules/*. No editar: se regenera solo.\n// ${what}\n`;

const server =
  banner("Sistemas de juego de los módulos instalados (el genérico lo añade createRegistry).") +
  `import type { GameSystem } from "@pyv/shared";\n` +
  found.map((m, i) => `import { system as s${i} } from "${m.name}";\n`).join("") +
  `\nexport const MODULE_SYSTEMS: readonly GameSystem<any>[] = [${found.map((_, i) => `s${i}`).join(", ")}];\n`;

const client =
  banner("Interfaces de usuario de los módulos instalados.") +
  `import type { SystemUi } from "./types";\n` +
  found.map((m, i) => `import { ui as u${i} } from "${m.name}/ui";\n`).join("") +
  `\nexport const MODULE_UIS: readonly SystemUi[] = [${found.map((_, i) => `u${i}`).join(", ")}];\n`;

// Tailwind no escanea carpetas que git ignora (modules/* lo está), así que sus clases se le pasan explícitamente
// con `@source inline(...)`: se extraen las palabras con forma de clase de los .ts/.tsx de cada módulo.
const candidates = extractCandidates(found.map((m) => join(modulesDir, m.dir, "src")));
const css =
  banner("Clases de Tailwind usadas por los módulos (modules/ está en .gitignore y Tailwind no lo escanea).").replace(/^\/\//gm, "/*").replace(/\n/g, " */\n") +
  (candidates.length ? `@source inline("${candidates.join(" ")}");\n` : "");

// Para los módulos empaquetados (.pyvmod), el servidor compila al arrancar una hoja de estilos con las clases del
// VTT y las de los paquetes (server/src/moduleCss.ts). Necesita el tema y las clases del cliente, que en la versión
// instalada ya no está como código fuente: se guardan aquí y van dentro del servidor compilado.
const indexCss = readFileSync(join(root, "client", "src", "index.css"), "utf8");
const theme = /@theme\s*\{[\s\S]*?\n\}/.exec(indexCss)?.[0] ?? "";
const hostCandidates = extractCandidates([join(root, "client", "src"), ...found.map((m) => join(modulesDir, m.dir, "src"))]);
const hostStyles =
  banner("Tema y clases de Tailwind del cliente (y de los módulos de modules/), para los estilos de los paquetes .pyvmod.") +
  `export const HOST_THEME = ${JSON.stringify(theme)};\n` +
  `export const HOST_CANDIDATES: readonly string[] = ${JSON.stringify(hostCandidates)};\n`;

let changed = 0;
for (const [file, content] of [
  [join(root, "server", "src", "modules.generated.ts"), server],
  [join(root, "client", "src", "systems", "modules.generated.ts"), client],
  [join(root, "client", "src", "modules.generated.css"), css],
  [join(root, "server", "src", "host-styles.generated.ts"), hostStyles],
]) {
  // Solo escribir si cambia: así Vite y tsx no recargan sin motivo.
  if (existsSync(file) && readFileSync(file, "utf8") === content) continue;
  writeFileSync(file, content);
  changed++;
}
const list = baseOnly ? "ninguno (compilación base, sin modules/)" : found.length ? found.map((m) => `${m.id} (modules/${m.dir})`).join(", ") : "ninguno";
console.log(`[módulos] Sistemas de juego instalados: ${list}${changed ? "" : " (sin cambios)"}`);
