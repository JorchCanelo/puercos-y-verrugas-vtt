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

let changed = 0;
for (const [file, content] of [
  [join(root, "server", "src", "modules.generated.ts"), server],
  [join(root, "client", "src", "systems", "modules.generated.ts"), client],
]) {
  // Solo escribir si cambia: así Vite y tsx no recargan sin motivo.
  if (existsSync(file) && readFileSync(file, "utf8") === content) continue;
  writeFileSync(file, content);
  changed++;
}
const list = found.length ? found.map((m) => `${m.id} (modules/${m.dir})`).join(", ") : "ninguno";
console.log(`[módulos] Sistemas de juego instalados: ${list}${changed ? "" : " (sin cambios)"}`);
