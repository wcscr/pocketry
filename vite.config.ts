import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Keep the source and built distributions' legal notices in sync. */
function legalFilesPlugin(): Plugin {
  return {
    name: "pocketry-legal-files",
    apply: "build",
    generateBundle() {
      for (const fileName of ["LICENSE", "NOTICE"]) {
        this.emitFile({
          type: "asset",
          fileName: `${fileName}.txt`,
          source: readFileSync(path.resolve(__dirname, fileName), "utf8"),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), legalFilesPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
  },
  optimizeDeps: {
    // Emscripten glue does not survive esbuild's dependency pre-bundling.
    exclude: ["@techstark/opencv-js", "manifold-3d"],
    esbuildOptions: {
      loader: {
        ".js": "jsx",
      },
    },
  },
  // Geometry runs in a module worker so the main thread stays responsive.
  worker: {
    format: "es",
  },
  server: {
    fs: {
      allow: [".."],
    },
  },
  assetsInclude: ["**/*.wasm"],
});
