import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { build } from "vite";
import { bundledNpmNotices, legalFilesPlugins } from "./bundled-notices";

const fixtures: string[] = [];
function fixture(): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pocketry-notices-")));
  fixtures.push(root);
  mkdirSync(path.join(root, "licenses/npm"), { recursive: true });
  writeFileSync(path.join(root, "licenses/npm/supplements.json"), "[]");
  writeFileSync(path.join(root, "LICENSE"), "Project license\n");
  writeFileSync(path.join(root, "NOTICE"), "Vendored asset notice\n");
  return root;
}
function dependency(root: string, location: string, name: string, version: string, files: Record<string, string>): string {
  const directory = path.join(root, "node_modules", location);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name, version, type: "module", main: "index.js", license: "MIT" }));
  writeFileSync(path.join(directory, "index.js"), `export const value = ${JSON.stringify(name)};`);
  for (const [file, text] of Object.entries(files)) writeFileSync(path.join(directory, file), text);
  return path.join(directory, "index.js");
}
afterEach(() => { for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("retains full license and notice texts, scoped/nested versions, and deterministic duplicate handling", () => {
  const root = fixture();
  const a = dependency(root, "@scope/lib", "@scope/lib", "2.0.0", { "LICENSE.md": "Copyright A\nPermission A\n", NOTICE: "Additional attribution A\n" });
  const b = dependency(root, "parent/node_modules/lib", "lib", "1.0.0", { COPYING: "Copyright B\nPermission B\n" });
  const result = bundledNpmNotices(root, [b + "?url", "\0" + a + "?commonjs-proxy", a]);
  expect(result).toContain("Copyright A\nPermission A\n");
  expect(result).toContain("Additional attribution A");
  expect(result).toContain("Copyright B\nPermission B\n");
  expect(result.match(/@scope\/lib@2.0.0/g)).toHaveLength(1);
  expect(result).toBe(bundledNpmNotices(root, [a, b]));
  expect(result).not.toContain(root);
});

it("requires a reviewed supplement for the exact version when the npm archive has no license", () => {
  const root = fixture();
  const id = dependency(root, "missing", "missing", "1.0.0", { NOTICE: "Additional upstream notice" });
  const render = () => bundledNpmNotices(root, [id]);
  expect(render).toThrow("Missing license text for bundled missing@1.0.0");
  writeFileSync(path.join(root, "licenses/npm/upstream.txt"), "Verified upstream permission\n");
  writeFileSync(path.join(root, "licenses/npm/supplements.json"), JSON.stringify([{ packages: ["missing@1.0.0"], file: "upstream.txt", sources: ["https://example.test/pinned/LICENSE"] }]));
  expect(render()).toContain("Verified upstream permission");
  expect(render()).toContain("Additional upstream notice");
  writeFileSync(path.join(path.dirname(id), "package.json"), JSON.stringify({ name: "missing", version: "1.0.1" }));
  expect(render).toThrow("Missing license text for bundled missing@1.0.1");
});

it("does not treat an empty license as notice coverage", () => {
  const root = fixture();
  const id = dependency(root, "empty", "empty", "1.0.0", { LICENSE: "\n" });
  expect(() => bundledNpmNotices(root, [id])).toThrow("Missing license text");
});

it("ships licenses from both browser and worker bundles and drops removed packages on rebuild", async () => {
  const root = fixture();
  dependency(root, "browser-lib", "browser-lib", "1.0.0", { LICENSE: "Browser permission\n" });
  dependency(root, "worker-lib", "worker-lib", "1.0.0", { LICENSE: "Worker permission\n" });
  dependency(root, "unused-lib", "unused-lib", "1.0.0", { LICENSE: "Unused permission\n" });
  writeFileSync(path.join(root, "index.html"), '<script type="module" src="/main.js"></script>');
  writeFileSync(path.join(root, "main.js"), 'import {value} from "browser-lib"; console.log(value); new Worker(new URL("./worker.js", import.meta.url), {type:"module"});');
  writeFileSync(path.join(root, "worker.js"), 'import {value} from "worker-lib"; postMessage(value);');
  const plugins = legalFilesPlugins(root);
  const compile = () => build({ configFile: false, root, logLevel: "silent", plugins: [plugins.main], worker: { format: "es", plugins: () => [plugins.worker()] } });
  await compile();
  const notice = readFileSync(path.join(root, "dist/NOTICE.txt"), "utf8");
  expect(notice).toContain("Vendored asset notice");
  expect(notice).toContain("Browser permission");
  expect(notice).toContain("Worker permission");
  expect(notice).not.toContain("Unused permission");
  expect(readFileSync(path.join(root, "dist/LICENSE.txt"), "utf8")).toBe("Project license\n");
  writeFileSync(path.join(root, "main.js"), 'console.log("No dependencies");');
  await compile();
  expect(readFileSync(path.join(root, "dist/NOTICE.txt"), "utf8")).not.toContain("Worker permission");
  expect(readFileSync(path.join(root, "dist/NOTICE.txt"), "utf8")).not.toContain("Browser permission");
});
