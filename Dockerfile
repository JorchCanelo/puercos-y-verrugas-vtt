# Puercos y Verrugas VTT — imagen para el MODO SERVIDOR (un solo puerto, panel del anfitrión en /admin).
# Multiarquitectura: linux/amd64 y linux/arm64 (Raspberry Pi 3/4/5 con sistema de 64 bits).
#
#   docker build -t pyv-vtt .
#   docker run -p 3000:3000 -v pyv-datos:/data -e VTT_ADMIN_PASSWORD=una-clave-larga pyv-vtt
#
# Lleva solo el VTT base (el repositorio no incluye modules/): los sistemas de juego se instalan como .pyvmod
# desde el panel y quedan en el volumen de datos.

# --- 1) Compilar cliente y servidor -------------------------------------------------------------
# Se compila en la arquitectura de la máquina que construye (el resultado es JavaScript y sirve para todas):
# así una Raspberry Pi no tiene que compilar nada y GitHub Actions no emula ARM para esto.
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build
WORKDIR /src
COPY . .
RUN npm install --no-audit --no-fund \
 && node scripts/modules.mjs --base \
 && npm run build -w client \
 && npm run build -w server

# --- 2) Dependencias de ejecución del servidor ----------------------------------------------------
# Solo las del servidor (todas son JavaScript puro, sin binarios nativos). @pyv/shared ya va dentro del bundle.
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS deps
WORKDIR /deps
COPY server/package.json /tmp/server-package.json
RUN node -e "const p=require('/tmp/server-package.json');const d={...p.dependencies};delete d['@pyv/shared'];require('fs').writeFileSync('package.json',JSON.stringify({name:'pyv-server-runtime',private:true,type:'module',dependencies:d},null,2))" \
 && npm install --omit=dev --no-audit --no-fund

# --- 3) Imagen final ------------------------------------------------------------------------------
FROM node:24-bookworm-slim
# Puerto: 3000, o el de VTT_PORT / PORT (la variable que dan muchas plataformas de hosting).
ENV NODE_ENV=production \
    VTT_DATA_DIR=/data \
    VTT_PUBLIC_HOST=0.0.0.0
WORKDIR /app
COPY --from=deps /deps/node_modules ./node_modules
COPY --from=build /src/server/package.json ./server/package.json
COPY --from=build /src/server/dist ./server/dist
COPY --from=build /src/client/dist ./client/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.VTT_PORT||process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/dist/main.js"]
