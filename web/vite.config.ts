import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const PDFJS = path.join(path.dirname(fileURLToPath(import.meta.url)), "node_modules", "pdfjs-dist");
const PDFJS_ASSETS = ["cmaps", "standard_fonts", "wasm", "iccs"];

function* walk(dir: string, base = ""): Generator<string> {
  for (const name of readdirSync(dir)) {
    const rel = path.posix.join(base, name);
    if (statSync(path.join(dir, name)).isDirectory()) yield* walk(path.join(dir, name), rel);
    else yield rel;
  }
}

/** The files pdf.js loads at run time (fonts, character maps, decoders), published under /pdfjs/ in the build and in development. */
function pdfjsAssets(): Plugin {
  return {
    name: "pdfjs-assets",
    configureServer(server) {
      server.middlewares.use("/pdfjs", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "").split("?")[0]).replace(/^\/+/, "");
        const [top] = rel.split("/");
        if (!PDFJS_ASSETS.includes(top) || rel.includes("..")) return next();
        try {
          res.setHeader("Content-Type", rel.endsWith(".wasm") ? "application/wasm" : "application/octet-stream");
          res.end(readFileSync(path.join(PDFJS, rel)));
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      for (const dir of PDFJS_ASSETS) for (const rel of walk(path.join(PDFJS, dir), dir)) this.emitFile({ type: "asset", fileName: `pdfjs/${rel}`, source: readFileSync(path.join(PDFJS, rel)) });
    },
  };
}

// The API lives on the HEIG-Kit server (npm run server, port 8766 by default); in development Vite proxies it.
export default defineConfig({
  plugins: [react(), tailwindcss(), pdfjsAssets()],
  server: {
    port: 5180,
    proxy: {
      "/api": { target: process.env.HEIG_DEV_API ?? "http://127.0.0.1:8766", changeOrigin: true },
      "/files": { target: process.env.HEIG_DEV_API ?? "http://127.0.0.1:8766", changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 1200 },
});
