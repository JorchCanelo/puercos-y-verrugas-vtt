// Descubre los módulos de sistema de juego instalados en modules/* y genera los registros que importan
// el servidor y el cliente. Se ejecuta solo (postinstall, predev, prebuild, pretypecheck, pretest); también: npm run modules.
//
// Un módulo es una carpeta modules/<nombre>/ con un package.json que:
//   - tiene "pyv": { "id": "<id-del-sistema>" }
//   - exporta "." con `export const system: GameSystem` y "./ui" con `export const ui: SystemUi`.
// Los archivos generados están en .gitignore: el VTT base compila igual sin ningún módulo.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const modulesDir = join(root, "modules");
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const found = [];
if (existsSync(modulesDir)) {
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
// Tailwind descarta las que no son clases; sobrar no cuesta nada, faltar deja estilos sin generar.
function listSources(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listSources(full));
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(full);
  }
  return out;
}
// Forma de clase de Tailwind: empieza en minúscula (o "-", "!", "@", "*") y sin espacios ni comillas.
const CANDIDATE = /^[-!@*]?[a-z][a-z0-9:/\[\]().%#_,=+!-]*$/;
// Paréntesis y corchetes desparejados (trozos de código como "(1-2" o "a[j]]") rompen el análisis de @source inline.
function balanced(word) {
  const stack = [];
  for (const ch of word) {
    if (ch === "(" || ch === "[") stack.push(ch === "(" ? ")" : "]");
    else if (ch === ")" || ch === "]") if (stack.pop() !== ch) return false;
  }
  return stack.length === 0 && !/[,.:]$/.test(word);
}
const candidates = new Set();
for (const m of found) {
  for (const file of listSources(join(modulesDir, m.dir, "src"))) {
    const code = readFileSync(file, "utf8");
    // Como el extractor de Tailwind: trocear todo el archivo por espacios, comillas, llaves y signos de JSX.
    for (const word of code.split(/[\s"'`{}<>;]+/)) {
      if (word.length > 1 && word.length <= 80 && CANDIDATE.test(word) && balanced(word)) candidates.add(word);
    }
  }
}
const css =
  banner("Clases de Tailwind usadas por los módulos (modules/ está en .gitignore y Tailwind no lo escanea).").replace(/^\/\//gm, "/*").replace(/\n/g, " */\n") +
  (candidates.size ? `@source inline("${[...candidates].sort().join(" ")}");\n` : "");

let changed = 0;
for (const [file, content] of [
  [join(root, "server", "src", "modules.generated.ts"), server],
  [join(root, "client", "src", "systems", "modules.generated.ts"), client],
  [join(root, "client", "src", "modules.generated.css"), css],
]) {
  // Solo escribir si cambia: así Vite y tsx no recargan sin motivo.
  if (existsSync(file) && readFileSync(file, "utf8") === content) continue;
  writeFileSync(file, content);
  changed++;
}
const list = found.length ? found.map((m) => `${m.id} (modules/${m.dir})`).join(", ") : "ninguno";
console.log(`[módulos] Sistemas de juego instalados: ${list}${changed ? "" : " (sin cambios)"}`);
