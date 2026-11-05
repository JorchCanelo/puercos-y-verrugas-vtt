# Módulos de sistema de juego

El VTT no trae reglas: cada Partida usa un **sistema de juego**. Sin ningún módulo solo existe el sistema **genérico**
(hoja libre: nombre, imagen, notas y campos de texto; las tiradas se hacen con los dados libres).

Un módulo añade un sistema: hoja de personaje, creación, movimientos, progreso, catálogo… Cada módulo es su propio
repositorio y se clona dentro de esta carpeta (que está en `.gitignore`, salvo este README).

## Instalar un módulo

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
`server/src/modules.generated.ts`, `client/src/systems/modules.generated.ts` y `client/src/modules.generated.css`. Esos archivos no se versionan.
