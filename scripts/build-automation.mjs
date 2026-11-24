import { build } from "esbuild";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
await build({
  entryPoints: ["server/automation/cli.ts", "server/automation/export-worker.ts"],
  outdir: "dist/automation",
  bundle: true,
  format: "esm",
  platform: "node",
  packages: "external",
  plugins: [{
    name: "pocketry-typeface-json",
    setup(builder) {
      // Browser and Node use the same bundled Three typefaces. Node otherwise
      // expects import attributes on an external JSON module.
      builder.onResolve({ filter: /^three\/examples\/fonts\// }, args => ({ path: require.resolve(args.path) }));
    },
  }],
});
