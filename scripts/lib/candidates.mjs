// Extrae las palabras con forma de clase de Tailwind de un código fuente, como hace el extractor de Tailwind:
// trocea por espacios, comillas, llaves y signos de JSX. Sobrar no cuesta nada (Tailwind descarta lo que no es
// una clase); faltar deja estilos sin generar. Lo usan scripts/modules.mjs y scripts/pack-module.mjs.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Archivos .ts/.tsx/.js/.jsx de una carpeta (sin node_modules ni ocultos). */
export function listSources(dir) {
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

/** Candidatos de todos los archivos de código de las carpetas dadas, ordenados y sin repetir. */
export function extractCandidates(dirs) {
  const candidates = new Set();
  for (const dir of dirs) {
    for (const file of listSources(dir)) {
      const code = readFileSync(file, "utf8");
      for (const word of code.split(/[\s"'`{}<>;]+/)) {
        if (word.length > 1 && word.length <= 80 && CANDIDATE.test(word) && balanced(word)) candidates.add(word);
      }
    }
  }
  return [...candidates].sort();
}
