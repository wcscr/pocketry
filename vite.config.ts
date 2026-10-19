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

/** Disable Vite's desktop-editor shortcut; Pocketry's browser editors are unaffected. */
function disableEditorLaunchPlugin(): Plugin {
  return {
    name: "pocketry-disable-editor-launch",
    configureServer(server) {
      // Mount before Vite's launcher using the same Connect path matching. Parsing
      // with new URL would normalize dot segments that Connect still routes here.
      server.middlewares.use("/__open-in-editor", (_req, res) => {
        res.statusCode = 404;
        res.end("Not Found");
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), legalFilesPlugin(), disableEditorLaunchPlugin()],
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
    host: "127.0.0.1",
    allowedHosts: [],
    fs: {
      strict: true,
      // Shared source and dependencies are imported by the client and its workers.
      // Other repository files are denied unless explicitly imported by client code.
      allow: ["client", "shared", "node_modules"].map(directory => path.resolve(__dirname, directory)),
    },
  },
  assetsInclude: ["**/*.wasm"],
});
