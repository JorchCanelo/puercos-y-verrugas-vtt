// Proceso principal de Electron: arranca el servidor dentro de la app y abre el panel del anfitrión (127.0.0.1:3001).
import { app, BrowserWindow, shell, dialog } from "electron";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// Empaquetado: desktop/app/{server,client}. En desarrollo: ../server/dist y ../client/dist.
const packaged = existsSync(join(here, "app", "server", "index.js"));
const serverEntry = packaged ? join(here, "app", "server", "index.js") : join(here, "..", "server", "dist", "index.js");
const clientDir = packaged ? join(here, "app", "client") : join(here, "..", "client", "dist");
// Datos: sin empaquetar (npm run desktop) se usan los mismos que `npm run play` (server/data), así se ve la misma mesa.
// Instalada (npm run dist) no hay carpeta server/, así que van a %APPDATA%\Puercos y Verrugas VTT\data.
const dataDir = packaged ? join(app.getPath("userData"), "data") : join(here, "..", "server", "data");

if (!app.requestSingleInstanceLock()) app.quit();

let running = null;
let win = null;

async function boot() {
  if (!existsSync(serverEntry)) {
    throw new Error(`No existe ${serverEntry}. Ejecuta "npm run build" primero.`);
  }
  const { start } = await import(pathToFileURL(serverEntry).href);
  running = await start({
    dataDir,
    clientDir: existsSync(clientDir) ? clientDir : null,
  });
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: "Puercos y Verrugas VTT",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Enlaces externos (https) en el navegador; ventanas locales (otra pestaña de la app) dentro de Electron.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^http:\/\/(127\.0\.0\.1|localhost):\d+\//.test(url)) return { action: "allow" };
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  await win.loadURL(`http://127.0.0.1:${running.adminPort}/`);
  win.on("closed", () => (win = null));
}

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => boot().catch((e) => {
  dialog.showErrorBox("Puercos y Verrugas VTT", String(e?.stack ?? e));
  app.quit();
}));

app.on("window-all-closed", () => app.quit());
app.on("before-quit", (ev) => {
  if (!running) return;
  ev.preventDefault();
  const r = running;
  running = null;
  r.close().catch(() => {}).finally(() => app.exit(0));
});
