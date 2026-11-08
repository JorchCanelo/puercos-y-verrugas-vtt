// Arranque desde la terminal: `npm run dev` / `npm start`.
import { start } from "./index";

const dev = process.argv.includes("--dev");
const running = await start({ logger: dev, dev });
console.log(
  running.adminPort === null
    ? `
  Puercos y Verrugas VTT en marcha (modo servidor)
  ─ Jugadores:              puerto ${running.publicPort}${running.publicUrl ? ` · ${running.publicUrl}` : ""}
  ─ Panel del anfitrión:    ${running.publicUrl ?? "<tu dirección>"}/admin (con VTT_ADMIN_PASSWORD)
`
    : `
  Puercos y Verrugas VTT en marcha
  ─ Panel del anfitrión (solo tu PC):  http://127.0.0.1:${running.adminPort}
  ─ Jugadores (red local / túnel):      puerto ${running.publicPort}
`,
);

const shutdown = async () => {
  await running.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
