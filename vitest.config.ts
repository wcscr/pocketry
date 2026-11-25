import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

/**
 * Node arguments for the jsdom test workers.
 *
 * Node 25 and newer define their own `localStorage` and `sessionStorage`
 * globals. Vitest 4's jsdom environment copies a window property onto the Node
 * global only if the global does not already have it, so jsdom's storage stays
 * hidden behind Node's. Node's `localStorage` is undefined unless
 * `--localstorage-file` is given, so storage-backed tests fail with
 * "Cannot read properties of undefined (reading 'setItem')".
 *
 * Turning off Node's Web Storage in these workers lets jsdom provide both
 * globals, as on Node 22. Vitest 4 has no environment option for this. A setup
 * file could re-point the globals at `globalThis.jsdom.window`, but it would
 * duplicate the environment's global copying and teardown. The flag is
 * accepted on Node 22.4+, where it matches the default. Node-environment
 * projects are unchanged. `client/src/jsdom-environment.test.ts` guards this.
 * Vitest 5.1 copies `localStorage` itself; recheck this flag when upgrading.
 */
const jsdomExecArgv = ["--no-experimental-webstorage"];

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
      // Bound memory/CPU use for local CAD and jsdom workers.
      maxWorkers: 4,
      projects: [
        {
          extends: true,
          test: {
            name: "quick-unit",
            environment: "node",
            exclude: [...configDefaults.exclude, "**/*.qualification.test.ts"],
            include: [
              "shared/**/*.test.ts",
              "client/src/lib/**/*.test.ts",
              "server/**/*.test.ts",
              "cloudflare/**/*.test.ts",
              "scripts/**/*.test.ts",
            ],
          },
        },
        {
          extends: true,
          test: {
            name: "quick-ui",
            environment: "jsdom",
            execArgv: jsdomExecArgv,
            exclude: [...configDefaults.exclude, "**/*.workflow.test.{ts,tsx}"],
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
        {
          extends: true,
          test: {
            name: "geometry",
            environment: "node",
            include: ["client/src/lib/**/*.qualification.test.ts"],
            // Detailed CAD/export checks need more time than small unit cases.
            // Existing explicit per-test limits still apply.
            testTimeout: 30_000,
          },
        },
        {
          extends: true,
          test: {
            name: "workflows",
            environment: "jsdom",
            execArgv: jsdomExecArgv,
            include: ["client/src/**/*.workflow.test.{ts,tsx}"],
          },
        },
      ],
      coverage: {
        provider: "v8",
        include: ["shared/**", "client/src/lib/**"],
        exclude: ["**/*.test-support.{ts,tsx}", "**/*.test-helpers.{ts,tsx}"],
      },
    },
  }),
);
