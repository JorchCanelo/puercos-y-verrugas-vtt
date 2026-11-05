# Módulos de sistema de juego

El VTT no trae reglas: cada Partida usa un **sistema de juego**. Sin ningún módulo solo existe el sistema **genérico**
(hoja libre: nombre, imagen, notas y campos de texto; las tiradas se hacen con los dados libres).

Un módulo añade un sistema: hoja de personaje, creación, movimientos, progreso, catálogo… Cada módulo es su propio
repositorio y se clona dentro de esta carpeta (que está en `.gitignore`, salvo este README).

Hay dos formas de instalar un módulo:
- **Código fuente** en esta carpeta (para desarrollarlo; requiere Node y npm). Se compila dentro del VTT.
- **Archivo `.pyvmod`** (módulo empaquetado, ya compilado): se instala desde el panel del anfitrión, también en la
  **versión instalada** del VTT, que no tiene Node ni puede compilar nada. Ver [Empaquetar](#empaquetar-un-módulo-pyvmod).

Si un mismo módulo está de las dos formas, gana el código fuente.

## Instalar un módulo (código fuente)

```sh
cd modules
git clone <url-del-módulo> <nombre-de-carpeta>
cd ..
npm install        # enlaza el módulo y regenera la lista de sistemas
npm run play       # o npm run dev
```

Al arrancar verás en la consola `[módulos] Sistemas de juego instalados: …`. En el panel del anfitrión, al crear una
Partida, ya se podrá elegir ese sistema.

**Desinstalar:** borra su carpeta y ejecuta `npm install`. Las Partidas que lo usaban siguen abriendo, pero sus
personajes quedan en **solo lectura** (no se pierde nada; al reinstalar el módulo vuelven a funcionar).

> Un módulo es código que se ejecuta en el servidor del anfitrión y en el navegador de los jugadores.
> Instala solo módulos de quien confíes.

## Escribir un módulo

Carpeta `modules/<nombre>/` con un `package.json` así:

```json
{
  "name": "@pyv/mod-<nombre>",
  "private": true,
  "type": "module",
  "pyv": { "id": "<id-del-sistema>" },
  "exports": { ".": "./src/index.ts", "./ui": "./src/ui/index.tsx" },
  "scripts": { "test": "tsx --test test/*.test.ts", "typecheck": "tsc --noEmit" },
  "dependencies": { "@pyv/shared": "*", "@pyv/client": "*", "zod": "^4.6.7" },
  "peerDependencies": { "react": "^18.3.1" }
}
```

- `pyv.id`: id estable del sistema (minúsculas, números y guiones). Se guarda en cada Partida: **no lo cambies**.
- `"."` debe exportar `system`, un `GameSystem` (ver `shared/src/system.ts`): esquema de la hoja y de su PATCH
  (usa `patchOf`), nombre a mostrar, claves que el jugador edita sin «edición libre», y opcionalmente
  `validateCreation`, `canAct`, `moves`, `progress` y `catalog`. Esta parte se ejecuta en el servidor y en el navegador:
  sin React ni APIs de Node.
- `"./ui"` debe exportar `ui`, un `SystemUi` (ver `client/src/systems/types.ts`): la hoja (`SheetView`) y opcionalmente
  el asistente de creación, el resumen en la lista de PJs, los movimientos, el color de las fichas y etiquetas.
  La interfaz importa del cliente **solo** desde `@pyv/client/sdk`.
- Reglas: las tiradas se resuelven en el servidor con el `Die` que recibe `moves.roll` (así se pueden probar).
  Los errores de reglas se lanzan con `RuleError` y le llegan al usuario como mensaje.
- Las hojas se guardan como JSON. Al añadir campos, ponles `.default()` para no romper hojas existentes.
- Estilos: usa clases de Tailwind normales. Como `modules/` está en `.gitignore`, Tailwind no lo escanea: `scripts/modules.mjs`
  extrae las clases de tus `.ts`/`.tsx` y las registra en `client/src/modules.generated.css`. Si añades clases nuevas,
  vuelve a arrancar `npm run dev` (o `npm run modules`). Los colores propios del sistema, mejor en línea (`style`).

`npm run modules` (y cada `install`, `dev`, `build`, `typecheck` y `test`) regenera
`server/src/modules.generated.ts`, `client/src/systems/modules.generated.ts`, `client/src/modules.generated.css` y
`server/src/host-styles.generated.ts`. Esos archivos no se versionan.

## Empaquetar un módulo (.pyvmod)

Con el módulo en `modules/<carpeta>/` (y `npm install` hecho), desde la raíz del VTT:

```sh
npm run pack-module -- <carpeta>
```

Crea `release/modulos/<id>-<versión>.pyvmod` (la versión sale del `"version"` del `package.json`; el nombre que se ve en
el panel, de `"pyv": { "nombre": "…" }`). Ese archivo es lo que se reparte: el anfitrión lo instala con
**«Instalar módulo…»** en el panel (o lo copia a la carpeta `modulos/` de sus datos) y **reinicia el VTT**.
Instalar otra versión del mismo módulo sustituye a la anterior.

Qué lleva dentro (JSON comprimido con gzip; formato en `shared/src/modules.ts`):
- `servidor`: el `"."` compilado a un solo archivo; se ejecuta en el servidor al arrancar.
- `interfaz`: el `"./ui"` compilado para el navegador; los jugadores lo descargan del servidor (con sesión iniciada).
- `clases`: las clases de Tailwind del módulo; el servidor genera con ellas una hoja de estilos al arrancar.

**React, zod, `@pyv/shared` y `@pyv/client/sdk` no van dentro:** los pone el VTT al cargar el paquete, así el módulo usa
exactamente los mismos (un solo React, los mismos errores de zod y `RuleError`). Cualquier otra dependencia de npm sí
se incluye. Por eso un paquete declara la versión de la API de módulos (`PYV_MODULE_API` en `shared/src/modules.ts`)
para la que se hizo: si no coincide con la del VTT, el panel lo marca como **incompatible** y no se carga. Al cambiar
de forma incompatible `GameSystem`, `SystemUi`, el SDK o `@pyv/shared`, sube `PYV_MODULE_API` y vuelve a empaquetar
los módulos.

> Un `.pyvmod` es código igual que un módulo en código fuente: instala solo los de quien confíes.
