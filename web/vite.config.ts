import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The API lives on the HEIG-Kit server (npm run server, port 8766 by default); in development Vite proxies it.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    proxy: {
      "/api": { target: process.env.HEIG_DEV_API ?? "http://127.0.0.1:8766", changeOrigin: true },
      "/files": { target: process.env.HEIG_DEV_API ?? "http://127.0.0.1:8766", changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 1200 },
});
