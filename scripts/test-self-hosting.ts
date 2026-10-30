// Run against a started Docker container; uses only Node 22 built-ins.
import assert from "node:assert/strict";

const base = new URL(process.argv[2] ?? "http://localhost:8080");
async function get(path: string, status = 200, options: RequestInit = {}) {
  const response = await fetch(new URL(path, base), {
    ...options, signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, status, `${options.method ?? "GET"} ${path}`);
  return response;
}

const index = await get("/");
assert.match(index.headers.get("content-type") ?? "", /text\/html/);
assert.equal(index.headers.get("cache-control"), "no-cache");
assert.equal(index.headers.get("x-content-type-options"), "nosniff");
const html = await index.text();
for (const route of ["/bin", "/about", "/index.html"]) {
  assert.equal(await (await get(route)).text(), html, `SPA route ${route}`);
}
for (const path of ["/api", "/api/images", "/API/images", "/api/images?x=1"]) {
  for (const method of ["GET", "HEAD", "POST"]) {
    await get(path, 404, { method });
  }
}
for (const path of ["/assets/missing.js", "/assets/missing.wasm", "/missing.js", "/.git/config"]) {
  await get(path, 404);
}

const scripts = [...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+\.(?:js|css))"/g)].map(m => m[1]);
assert(scripts.some(path => path.endsWith(".js")), "entry script exists");
assert(scripts.some(path => path.endsWith(".css")), "stylesheet exists");
let js = "";
for (const path of scripts) {
  const response = await get(path);
  assert.match(response.headers.get("content-type") ?? "", path.endsWith(".css") ? /text\/css/ : /javascript/);
  assert.match(response.headers.get("cache-control") ?? "", /immutable/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const body = await response.text();
  if (path.endsWith(".js")) js += body;
}
const worker = js.match(/\/assets\/bin\.worker-[\w-]+\.js/)?.[0];
assert(worker, "geometry worker is bundled");
const workerResponse = await get(worker);
assert.match(workerResponse.headers.get("content-type") ?? "", /javascript/);
js += await workerResponse.text();
const wasmPath = js.match(/\/assets\/manifold-[\w-]+\.wasm/)?.[0];
assert(wasmPath, "geometry WASM is bundled");
const wasm = await get(wasmPath);
assert.match(wasm.headers.get("content-type") ?? "", /application\/wasm/);
assert.deepEqual([...new Uint8Array(await wasm.arrayBuffer()).slice(0, 4)], [0, 97, 115, 109]);
const opencv = await get("/opencv/opencv.js");
assert.match(opencv.headers.get("content-type") ?? "", /javascript/);
assert.equal(opencv.headers.get("cache-control"), "no-cache");
assert((await opencv.text()).length > 100_000, "OpenCV bundle is served");
for (const [path, marker] of [["/LICENSE.txt", "GNU AFFERO"], ["/NOTICE.txt", "Sugarcreek Research"]]) {
  const response = await get(path);
  assert.match(response.headers.get("content-type") ?? "", /text\/plain/);
  assert((await response.text()).includes(marker), path);
}
console.log("Self-hosting smoke test passed: routes, API denial, assets, cache, worker/WASM, OpenCV, legal notices.");
