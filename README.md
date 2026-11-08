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

## Instalador de Windows
Para usar el VTT en un PC **sin Node, npm ni el código** (por ejemplo, si otra persona hace de anfitrión), genera el instalador:

```bash
npm run dist
```

Crea `release/Puercos y Verrugas VTT Setup <versión>.exe` (la versión es la de `desktop/package.json`). La primera vez
electron-builder descarga NSIS y otras herramientas, así que tarda más.

- **Solo lleva el VTT base** (sistema genérico). Los módulos de `modules/` no van dentro, aunque los tengas en tu carpeta:
  se instalan después desde el panel como `.pyvmod` (ver [Módulos](#módulos-de-sistema-de-juego)). Así el `.exe` se
  puede compartir sin repartir el contenido de ningún módulo.
- **"Windows protegió su PC" (SmartScreen):** sale porque el instalador no está firmado. Pulsa «Más información» →
  «Ejecutar de todas formas».
- Se instala para el usuario actual, sin preguntar carpeta, con acceso directo en el escritorio y en el menú Inicio.
  Se desinstala desde «Agregar o quitar programas».
- La primera vez, el Firewall de Windows pedirá permiso para «Puercos y Verrugas VTT»: acéptalo en redes privadas.
- Para publicarlo, súbelo como *Release* de GitHub; **no** lo añadas al repositorio (`release/` está en `.gitignore`).

### Datos de la versión instalada
- Viven en `%APPDATA%\Puercos y Verrugas VTT\data\` (base de datos, archivos subidos y módulos en `modulos\`),
  separados de los de `npm run play` (`server/data/`).
- **Desinstalar no borra los datos:** al reinstalar o actualizar sigues teniendo tus Partidas. Para borrarlas del
  todo, elimina esa carpeta a mano.
- **Llevar tu mesa a la versión instalada (o a otro PC):** cierra la app y copia el contenido de `server/data/` (o de
  la carpeta `data` del otro PC) a `%APPDATA%\Puercos y Verrugas VTT\data\`. Copia, no muevas: a partir de ahí son
  dos copias independientes y lo que se juegue en una no aparece en la otra.
- Si el error *"Cannot create symbolic link: A required privilege is not held by the client"* aparece al ejecutar
  `npm run dist`, activa el Modo de desarrollador de Windows (Configuración → Para programadores) o ejecuta la terminal
  como administrador una vez.

## Servidor en internet
La cuarta forma de usar el VTT (además de `npm run play`, la app de escritorio y el instalador): la mesa **siempre
encendida** en un servidor, con tu propio dominio. Sirve cualquier máquina que ejecute Docker: una Raspberry Pi en
casa (3, 4 o 5 con sistema de **64 bits**), un mini PC, un VPS o una plataforma de hosting.

**Qué cambia en modo servidor** (se activa al definir `VTT_ADMIN_PASSWORD`):
- Un solo puerto (3000). Los jugadores entran por `https://tu-dominio/` y el panel del anfitrión está en
  `https://tu-dominio/admin`, protegido con la contraseña (cookie propia de 12 h, límite de intentos por IP).
- El túnel rápido del panel se oculta: la dirección del servidor cumple esa función.
- En «Datos de la mesa» del panel: espacio usado, **descargar copia**, **restaurar copia** y **reiniciar el servidor**
  (para aplicar módulos y restauraciones; Docker lo vuelve a arrancar solo).

Sin esas variables todo funciona exactamente como siempre.

### Variables de entorno
| Variable | Qué hace |
|---|---|
| `VTT_ADMIN_PASSWORD` | Activa el modo servidor; contraseña del panel en `/admin` (mínimo 8 caracteres). Cambiarla cierra las sesiones abiertas del panel |
| `VTT_PUBLIC_URL` | Dirección pública, p. ej. `https://mesa.midominio.xyz` (enlace «Entrar como Narrador» y el que se muestra a los jugadores) |
| `VTT_DATA_DIR` | Carpeta de datos (en la imagen Docker: `/data`) |
| `VTT_PORT` o `PORT` | Puerto (por defecto 3000) |
| `VTT_TRUST_PROXY` | En qué proxy confiar para la IP real y el https. Por defecto `loopback` (túnel en la misma máquina o red del contenedor). En plataformas tipo Railway/Render: `true` |
| `VTT_RESTORE_MAX_MB` | Tamaño máximo de una copia subida para restaurar (por defecto 4096) |

### Con Docker y un túnel de Cloudflare (Raspberry Pi o cualquier equipo en casa)
El túnel publica la mesa en tu dominio **sin abrir puertos** en el router y funciona aunque tu proveedor de internet
use CGNAT. Necesitas un dominio cuyo DNS gestione Cloudflare (plan Free: el dominio sigue registrado donde lo compraste;
solo cambias sus *nameservers* a los que te da Cloudflare).

1. **Imagen:** este repositorio publica `ghcr.io/jorchcanelo/puercos-y-verrugas-vtt` (amd64 y arm64) con GitHub Actions
   en cada cambio de `main`. Para tu propio fork, copia `deploy/docker-publish.yml` a `.github/workflows/` y, tras la
   primera publicación, haz pública la imagen en GitHub (*Packages → la imagen → Package settings → Change visibility*).
   También puedes compilarla tú: `docker build -t pyv-vtt .`.
2. **Túnel:** en Cloudflare, *Networking → Tunnels → Create a tunnel* (tipo *Cloudflared*). Copia el **token**
   (la cadena larga después de `--token`). En la pestaña de rutas añade una *Published application*: subdominio y
   dominio a tu gusto y, como servicio, **`HTTP`** → **`localhost:3000`**.
3. **En el servidor:** copia la carpeta `deploy/` (`docker-compose.yml` y `.env.example`) y dentro:
   ```bash
   cp .env.example .env      # y rellena VTT_ADMIN_PASSWORD, VTT_PUBLIC_URL y CLOUDFLARE_TUNNEL_TOKEN
   mkdir -p datos            # créala tú: si la crea Docker, será de root y la mesa no podrá escribir
   docker compose up -d
   docker compose logs -f mesa
   ```
4. Abre `https://tu-dominio/admin`, entra con la contraseña y crea o restaura tu mesa.

**Actualizar:** `docker compose pull && docker compose up -d`. **Respaldo:** «Descargar copia» en el panel, o copia
la carpeta `datos/` con la mesa detenida.

### Llevar una mesa de tu PC al servidor
1. En el panel local (`npm run play` → http://127.0.0.1:3001) pulsa **Descargar copia** (`.pyvbak`).
2. En el panel del servidor, **Restaurar una copia** → elige el archivo → **Reiniciar el servidor**.

Cloudflare acepta subidas de hasta 100 MB. Si tu copia pesa más, abre el panel desde tu red local
(`http://IP-del-servidor:3000/admin`) o copia el archivo a la carpeta de datos con el nombre `restaurar.pyvbak`
(p. ej. `scp copia.pyvbak usuario@servidor:~/pyv/datos/restaurar.pyvbak`) y reinicia: se aplica al arrancar.
Al restaurar, los datos que había quedan en `datos/.anterior/`.

> No hay sincronización entre copias: si juegas en tu PC y en el servidor, son dos mesas distintas.

### Avisos
- El servidor queda expuesto en internet de forma permanente: usa una contraseña de panel larga y única, y mantén
  la imagen actualizada.
- La música y los archivos se descargan desde tu servidor: con conexión doméstica, lo que limita es tu velocidad de **subida**.
- Raspberry Pi: usa una fuente de alimentación adecuada y una microSD de resistencia («High Endurance») o un SSD por USB,
  y descarga copias con frecuencia.

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
- `server/`: Fastify + Socket.IO + SQLite (node:sqlite). Dos puertos: público `3000` (jugadores) y local `3001` (solo 127.0.0.1, anfitrión); en modo servidor, uno solo con el panel en `/admin`.
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
- El Narrador anfitrión entra sin contraseña solo mediante un token de un solo uso emitido por el panel (puerto local, o `/admin` con contraseña en modo servidor).
- Las tiradas se resuelven en el servidor.
- Tus datos (`data/`: base de datos y archivos subidos) están en `.gitignore`. Para llevarlos a otra carpeta, PC o servidor usa «Descargar copia» / «Restaurar una copia» del panel (o copia `server/data/` entera con el VTT cerrado).

## Estado de verificación (honesto)
- **Pruebas automáticas:** `shared` y la capa de servicios/autenticación/subidas y los módulos empaquetados del servidor (sobre node:sqlite, el mismo motor que usa el servidor), con un sistema de juego de prueba. El zoom/desplazamiento del tablero se probó en Chromium con ratón y toques simulados. La CI corre typecheck, pruebas y compilación en Windows y Linux.
- **Probado a mano:** una sesión real con 2 Narradores y 3 jugadores (incluida la música sincronizada), la app de escritorio (`npm run desktop`), el instalador (`npm run dist`) y la instalación de un módulo `.pyvmod` desde el panel en la versión instalada.
- **Sin pruebas automáticas:** capa HTTP/Socket.IO, la mayor parte del cliente, Electron y el túnel de cloudflared.
- **Nunca probado:** el túnel rápido de cloudflared. El modo servidor (Docker, túnel con nombre, copia y restauración) tiene pruebas automáticas de configuración, sesión del panel y copias; el despliegue real está pendiente de probar.

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
