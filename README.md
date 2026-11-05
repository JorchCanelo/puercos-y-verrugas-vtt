# Puercos y Verrugas VTT

Mesa virtual (VTT) para jugar rol en línea desde tu propio PC: hojas de personaje, tiradas, chat con susurros,
escenas con fichas, materiales, música sincronizada y hasta 10 jugadores conectados a la vez (también desde el celular).

El VTT no trae reglas de ningún juego: cada Partida usa un **sistema de juego**. De serie incluye el sistema
**genérico** (hoja libre con nombre, imagen, notas y campos de texto; las tiradas se hacen con los dados libres).
Otros sistemas se añaden como **módulos** (ver [Módulos](#módulos-de-sistema-de-juego)).

## Requisitos
- Node 22.5 o superior (recomendado 24) y npm. La base de datos usa `node:sqlite` (incluido en Node; no hay módulos nativos que compilar).
- Windows 10/11 o Linux. Para jugar por internet, opcionalmente [`cloudflared`](https://github.com/cloudflare/cloudflared) en el PATH (en Windows: `winget install --id Cloudflare.cloudflared`).

## Primer arranque
```bash
npm install
npm run play
```
Abre **http://127.0.0.1:3001**: es el panel del anfitrión, que solo existe en tu PC. Desde ahí creas Partidas
(eligiendo su sistema de juego), las abres a los jugadores, entras como Narrador sin contraseña y compartes los enlaces.

La primera vez, Windows pedirá permiso de Firewall para Node: acéptalo en redes privadas si quieres que los jugadores entren por tu red local.

## Jugar con otras personas
Ejecuta `npm run play` y comparte con tus jugadores:
- **Misma red (Wi-Fi):** la dirección `http://<ip-de-tu-pc>:3000` que muestra el panel del anfitrión.
- **Por internet:** el botón «Crear enlace para internet» del panel crea un túnel temporal de Cloudflare (requiere `cloudflared`). El enlace cambia cada vez.

Cada vez que cambie el código o instales un módulo, vuelve a ejecutar `npm run play` para recompilar.

## App de escritorio (Windows)
En vez de la terminal y el navegador, puedes usar el VTT como una ventana de Windows (Electron) que arranca el servidor por sí misma:

```bash
npm run desktop
```

- La primera vez instala `desktop/` por separado (descarga Electron, unos 100 MB) y tarda un poco; después solo recompila y abre la ventana.
- La ventana es el **panel del anfitrión** (lo mismo que http://127.0.0.1:3001). Desde ahí entras como Narrador y compartes los enlaces; los jugadores se conectan exactamente igual que con `npm run play` (puerto 3000 o túnel).
- Usa **los mismos datos** que `npm run play` (`server/data/`): ves las mismas Partidas.
- **No la abras a la vez que `npm run play`**: usan los mismos puertos y la misma base de datos. Cierra uno antes de abrir el otro.
- Al cerrar la ventana se detiene el servidor y se desconecta a todos los jugadores.
- Si la consola avisa de scripts sin aprobar tras cambiar la versión de Electron: `npm approve-scripts electron electron-winstaller --prefix desktop`.

## Módulos de sistema de juego
Un módulo aporta las reglas de un juego: hoja, creación de personajes, movimientos, progreso, catálogo…

### Instalar un módulo empaquetado (.pyvmod)
Funciona en todas las versiones, también en la **instalada** (sin Node ni código):
1. En el panel del anfitrión, sección **Módulos de sistema de juego**, pulsa **«Instalar módulo…»** y elige el archivo `.pyvmod`.
   (También puedes copiarlo a mano a la carpeta `modulos/` de tus datos: `server/data/modulos/` con `npm run play`,
   `%APPDATA%\Puercos y Verrugas VTT\data\modulos\` en la versión instalada. El panel muestra la ruta.)
2. **Reinicia el VTT** (cierra y abre la app, o vuelve a ejecutar `npm run play`). Los módulos se cargan al arrancar.

Para actualizarlo, instala la versión nueva (sustituye a la anterior) y reinicia. Para quitarlo, «Quitar» y reinicia.

### Instalar un módulo como código fuente (para desarrollarlo)
Cada módulo es su propio repositorio y se clona dentro de `modules/`:

```bash
cd modules
git clone <url-del-módulo> <carpeta>
cd ..
npm install
npm run play
```

Al arrancar, la consola muestra `[módulos] Sistemas de juego instalados: …` y el panel del anfitrión ya permite elegirlo.
Si quitas un módulo, las Partidas que lo usaban siguen abriendo, pero sus personajes quedan en **solo lectura** (sin perder datos).
Cómo escribir uno y cómo empaquetarlo como `.pyvmod` (`npm run pack-module -- <carpeta>`): [`modules/README.md`](modules/README.md).

> Un módulo es código que se ejecuta en tu PC y en el navegador de los jugadores: instala solo módulos de quien confíes.

## Scripts
| Comando | Qué hace |
|---|---|
| `npm run play` | Compila y arranca todo: **úsalo cuando jueguen otras personas**. Anfitrión en http://127.0.0.1:3001; jugadores por el puerto 3000 o el túnel |
| `npm run dev` | Solo para desarrollar: servidor (tsx watch) + cliente en caliente (Vite). El anfitrión entra por **http://localhost:5173**; el puerto 3000 no sirve interfaz en este modo |
| `npm test` | Pruebas (node:test) de `shared`, `server` y de los módulos instalados |
| `npm run typecheck` | `tsc --noEmit` en shared, server, client y los módulos instalados |
| `npm run modules` | Vuelve a detectar los módulos de `modules/` (también se hace solo al instalar, compilar, probar y arrancar) |
| `npm run build` | Compila cliente (Vite) y servidor (esbuild) |
| `npm run desktop` | Compila, instala `desktop/` por separado y abre la app de escritorio (ver [App de escritorio](#app-de-escritorio-windows)) |
| `npm run dist` | Instalador de Windows (NSIS) en `release/`, **solo con el VTT base**: los módulos de `modules/` no van dentro (se instalan después como `.pyvmod`) |
| `npm run pack-module -- <carpeta>` | Empaqueta `modules/<carpeta>` como `release/modulos/<id>-<versión>.pyvmod` para instalarlo desde el panel |

## Arquitectura
- `shared/`: interfaz de sistema de juego (`GameSystem`), sistema genérico, permisos, esquemas zod y tipos compartidos.
- `server/`: Fastify + Socket.IO + SQLite (node:sqlite). Dos puertos: público `3000` (jugadores) y local `3001` (solo 127.0.0.1, anfitrión).
- `client/`: React + Vite + Tailwind v4 + zustand + Konva. Los módulos usan solo lo que expone `client/src/sdk.ts`.
- `modules/`: sistemas de juego instalados. `scripts/modules.mjs` los detecta y genera los registros que cargan servidor y cliente.
- `desktop/`: envoltorio Electron.
- El snapshot (`GET /api/state`) es la fuente de verdad del estado de la mesa, filtrado por rol; los eventos `state:changed` provocan que el cliente lo vuelva a pedir.

## En la mesa
- **Roles:** Narradores (ven y editan todo) y Jugadores (ven solo sus propios personajes).
- **Dados libres** (todos): panel de dados o chat con `/r 3d8+2` (pública) y `/rp 1d20` (privada). Hasta 20 dados de d2 a d100, modificador de −20 a +20.
- **Chat:** como usuario o como un personaje propio; público o susurro a una sola persona (ni el Narrador lee susurros ajenos).
- **Tablero:** escenas de imagen libre o con cuadrícula. Rueda del ratón o botones −/+/Ajustar para el zoom; arrastra el fondo para moverte. En el celular, pellizca con dos dedos y arrastra con uno.

## Seguridad
- Contraseñas con scrypt; sesión en cookie firmada (HMAC).
- El Narrador anfitrión entra sin contraseña solo mediante un token de un solo uso emitido por el puerto local.
- Las tiradas se resuelven en el servidor.
- Tus datos (`data/`: base de datos y archivos subidos) están en `.gitignore`. Para copiarlos a otra carpeta o PC, copia `server/data/` entera.

## Estado de verificación (honesto)
- **Pruebas automáticas:** `shared` y la capa de servicios/autenticación/subidas del servidor (sobre node:sqlite, el mismo motor que usa el servidor), con un sistema de juego de prueba. El zoom/desplazamiento del tablero se probó en Chromium con ratón y toques simulados. La CI corre typecheck, pruebas y compilación en Windows y Linux.
- **Probado a mano:** una sesión real con 2 Narradores y 3 jugadores (incluida la música sincronizada) y la app de escritorio (`npm run desktop`).
- **Sin pruebas automáticas:** capa HTTP/Socket.IO, la mayor parte del cliente, Electron y el túnel de cloudflared.
- **Nunca probado:** el túnel de cloudflared y el instalador (`npm run dist`).

## Versiones mínimas por seguridad
Fijadas tras `npm audit` (los `^` en los `package.json` ya impiden bajar de estas):
| Paquete | Versión | Motivo |
|---|---|---|
| `zod` | 4.6.7 | Agotamiento de memoria al validar colecciones grandes (GHSA-mrhx-c7xc-m3w5) |
| `esbuild` | 0.28.2 | El servidor de desarrollo aceptaba peticiones de cualquier sitio web (GHSA-67mh-4wv8-2f99) |
| `@fastify/static` | 10.1.8 | Cuatro fallos de recorrido de rutas y evasión de protecciones |
| `electron` (en `desktop/`) | 45 | Electron 39–42 ya no tienen soporte y acumulan fallos de seguridad. Los avisos moderados de `minimatch` dentro de `electron-builder` (solo se usan al compilar para macOS) se aceptan |

Zod 4 aplica los `.default()` también dentro de `.optional()`, por eso los esquemas de edición parcial (PATCH) se construyen con `patchOf()` (`shared/src/patch.ts`).
Ejecuta `npm audit` de vez en cuando; evita `npm audit fix --force`, que puede añadir dependencias al paquete equivocado.

## Licencia
El código de este repositorio se publica bajo CC0 1.0 (dominio público; ver `LICENSE`). Los módulos de sistema de juego son proyectos aparte, con su propia licencia.
