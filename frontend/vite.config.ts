import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// En Windows la terminal puede entregar "c:\..." y Node "C:\..."; si se mezclan, rolldown
// cuenta el mismo archivo dos veces (React, react-router, react-query) y la app sale en blanco.
// Fijamos la raíz a la ruta canónica para que todas las rutas coincidan.
const root = fs.realpathSync.native(path.dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  root,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.png", "apple-touch-icon.png", "logo.webp"],
      manifest: {
        name: "BÁALAM GYM",
        short_name: "BÁALAM",
        description: "Asistencia, rutina y progreso en BÁALAM GYM",
        lang: "es-MX",
        start_url: "/app",
        display: "standalone",
        background_color: "#120A1C",
        theme_color: "#120A1C",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "/icon-monochrome.png", sizes: "192x192", type: "image/png", purpose: "monochrome" },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//, /^\/admin\//, /^\/media\//],
        globPatterns: ["**/*.{js,css,html,png,webp,svg}"],
        cleanupOutdatedCaches: true,
        importScripts: ["/push-sw.js"], // avisos al celular
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
  resolve: {
    alias: { "@": path.join(root, "src") },
    dedupe: ["react", "react-dom", "react-router", "react-router-dom", "@tanstack/react-query"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
      "/media": "http://localhost:8000",
      "/admin": "http://localhost:8000",
      "/static/admin": "http://localhost:8000",
    },
  },
});
