// Copia el servidor y el cliente ya compilados a desktop/app/ para empaquetarlos con electron-builder.
import { cpSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const out = join(root, "desktop", "app");
const need = [join(root, "server", "dist", "index.js"), join(root, "client", "dist", "index.html")];
for (const f of need) if (!existsSync(f)) throw new Error(`Falta ${f}. Ejecuta "npm run build" en la raíz antes.`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "server", "dist"), join(out, "server"), { recursive: true });
cpSync(join(root, "client", "dist"), join(out, "client"), { recursive: true });
console.log("desktop/app listo");
