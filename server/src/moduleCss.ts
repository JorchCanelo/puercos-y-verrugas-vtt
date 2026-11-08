// Estilos de los módulos empaquetados (.pyvmod). Sus clases de Tailwind no están en el CSS compilado del cliente,
// así que al arrancar se compila una hoja extra con Tailwind (paquete `tailwindcss`, JavaScript puro).
//
// La hoja lleva TODAS las clases del cliente más las de los paquetes, no solo las nuevas: se carga después del CSS
// del cliente y, si solo trajera las nuevas, el orden entre las dos hojas podría romper variantes (p. ej. una
// `p-3` del paquete pisando una `sm:p-4` del cliente). Siendo un superconjunto, el orden correcto lo decide ella.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { HOST_CANDIDATES, HOST_THEME } from "./host-styles.generated";

const req = createRequire(import.meta.url);

export async function buildModuleCss(extraCandidates: readonly string[]): Promise<string> {
  const { compile } = await import("tailwindcss");
  const input = [
    "@layer theme, base, components, utilities;",
    '@import "tailwindcss/theme.css" layer(theme);',
    '@import "tailwindcss/utilities.css" layer(utilities);',
    HOST_THEME,
  ].join("\n");
  const compiler = await compile(input, {
    base: dirname(req.resolve("tailwindcss/package.json")),
    loadStylesheet: async (id: string) => {
      const path = req.resolve(id);
      return { path, base: dirname(path), content: readFileSync(path, "utf8") };
    },
  });
  return compiler.build([...new Set([...HOST_CANDIDATES, ...extraCandidates])]);
}
