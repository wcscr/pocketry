import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

// Vitest config lives in its own file rather than as a `test` key on
// vite.config.ts: server/vite.ts imports vite.config.ts into the bundled Node
// server, and a `test` key would drag vitest into that bundle.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // `root` in vite.config.ts points at client/, which would hide shared/
      // and server/ from test discovery.
      root: import.meta.dirname,
      projects: [
        {
          extends: true,
          test: {
            name: "geometry",
            environment: "node",
            include: [
              "shared/**/*.test.ts",
              "client/src/lib/**/*.test.ts",
              "server/**/*.test.ts",
            ],
          },
        },
        {
          extends: true,
          test: {
            name: "ui",
            environment: "jsdom",
            include: [
              // App-root tests (the whole-app render smoke test).
              "client/src/*.test.{ts,tsx}",
              "client/src/components/**/*.test.{ts,tsx}",
              "client/src/hooks/**/*.test.{ts,tsx}",
              "client/src/pages/**/*.test.{ts,tsx}",
              "client/src/state/**/*.test.{ts,tsx}",
            ],
          },
        },
      ],
      coverage: {
        provider: "v8",
        include: ["shared/**", "client/src/lib/**"],
      },
    },
  }),
);
