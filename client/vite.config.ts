import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// En desarrollo, Vite (5173) reenvía la API al servidor: puerto público 3000 y panel local del anfitrión 3001.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/archivos": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/socket.io": { target: "http://127.0.0.1:3000", changeOrigin: true, ws: true },
      "/admin-api": { target: "http://127.0.0.1:3001", changeOrigin: true },
    },
  },
  build: { outDir: "dist" },
});
