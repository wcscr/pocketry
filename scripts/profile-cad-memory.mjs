/** Node 22 diagnostic. Instruments the existing construction without changing geometry.
 * node scripts/profile-cad-memory.mjs INPUT OUTPUT [--sharp-control] [--limit-mib=1024] [--repeat=1] [--mesh|--mixed]
 * A raised limit is confined to this process, never the browser default.
 */
import { createRequire } from "node:module";
import { resolve, join, dirname } from "node:path";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { unzipSync } from "fflate";
import initCad from "replicad-opencascadejs";

const [input, outputArg, ...flags] = process.argv.slice(2);
if (!input || !outputArg) throw new Error("Specify input project and output directory");
const output = resolve(outputArg), require = createRequire(import.meta.url);
const option = (name, fallback) => Number(flags.find(flag => flag.startsWith(`--${name}=`))?.split("=")[1] ?? fallback);
const limitMiB = option("limit-mib", 512), repeat = option("repeat", 1);
const engineModule = flags.find(flag => flag.startsWith("--engine-module="))?.slice("--engine-module=".length);
const engineWasm = flags.find(flag => flag.startsWith("--engine-wasm="))?.slice("--engine-wasm=".length);
assert(Boolean(engineModule) === Boolean(engineWasm), "An engine override requires both module and WASM paths");
const recycle = flags.find(flag => flag.startsWith("--recycle="))?.split("=")[1] ?? "none";
assert(["none", "dedicated", "unified"].includes(recycle));
assert(Number.isInteger(repeat) && repeat > 0 && repeat <= 20);
assert(limitMiB >= 512 && limitMiB <= 2048);
assert(!existsSync(output) || readdirSync(output).length === 0, "Use an empty output directory so a failure cannot leave a stale package");
mkdirSync(output, { recursive: true });
const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, logLevel: "error" });
const source = readFileSync(resolve(input));
const record = { node: process.version, sourceSha256: createHash("sha256").update(source).digest("hex"), limitMiB,
  profilerSha256: createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex"),
  sharpControl: flags.includes("--sharp-control"), diagnosticOnly: true, recycle, events: [], jobs: [], overrides: [] };
let oc, phase = "loading", operation = "loading", live = 0, peakHandles = 0;
const kinds = new Map(), seen = new WeakSet();
const started = performance.now();
const snapshot = (event, detail = {}) => {
  const data = { event, phase, operation, ms: performance.now() - started,
    wasmBytes: oc?.wasmMemory.buffer.byteLength ?? 0, trackedLiveHandles: live,
    rss: process.memoryUsage().rss, ...detail };
  record.events.push(data);
  return data;
};
try {
  const load = name => server.ssrLoadModule(resolve(name));
  const { parseProjectDoc } = await load("shared/gridfinity/project.ts");
  const { CadArena } = await load("client/src/lib/cad/arena.ts");
  const { CadContext } = await load("client/src/lib/cad/adapter.ts");
  const { exportStepPackage } = await load("client/src/lib/cad/package.ts");
  const original = parseProjectDoc(JSON.parse(source));
  assert(original, "Input must parse without geometry changes");
  const project = structuredClone(original);
  if (record.sharpControl) for (const collection of ["cutouts", "fingerHoles"]) {
    for (const object of project[collection]) for (const field of ["cornerRoundMm", "bottomFilletMm", "topFilletMm"]) {
      if (object[field]) { record.overrides.push({ collection, id: object.id, field, from: object[field], to: 0 }); object[field] = 0; }
    }
  }
  const restored = structuredClone(project);
  for (const change of record.overrides) restored[change.collection].find(object => object.id === change.id)[change.field] = change.from;
  assert.deepEqual(restored, original);
  assert.deepEqual(project.shapes, original.shapes);
  assert.deepEqual(project.spec, original.spec);
  writeFileSync(join(output, "input.pocketry.json"), JSON.stringify(project, null, 2));

  const own = CadArena.prototype.own;
  CadArena.prototype.own = function(handle) {
    if (!seen.has(handle)) {
      seen.add(handle); live++; peakHandles = Math.max(peakHandles, live);
      const type = handle.constructor.name, remove = handle.delete;
      kinds.set(type, (kinds.get(type) ?? 0) + 1);
      handle.delete = function() {
        const result = remove.call(this);
        live--; kinds.set(type, kinds.get(type) - 1);
        return result;
      };
    }
    return own.call(this, handle);
  };
  // Exactly the production capacity check, with an explicitly recorded diagnostic budget.
  CadContext.prototype.guard = function(name) {
    this.peakMemoryBytes = Math.max(this.peakMemoryBytes, this.oc.wasmMemory.buffer.byteLength);
    snapshot("guard", { operation: name });
    if (this.peakMemoryBytes >= limitMiB * 1024 * 1024) throw new Error(`${name}: CAD memory reached the ${limitMiB} MiB limit`);
    this.checkpoint(name);
  };
  for (const method of ["boolean", "fillet", "prism", "move", "rotate", "face", "wire", "profileWire", "valid", "inspectTopology"]) {
    const implementation = CadContext.prototype[method];
    CadContext.prototype[method] = function(...args) {
      const parent = operation;
      operation = method === "boolean" ? args[3] : method === "fillet" ? args[3] : method;
      const before = this.oc.wasmMemory.buffer.byteLength, handles = live;
      try { return implementation.apply(this, args); }
      finally {
        if (method === "boolean" || method === "fillet" || this.oc.wasmMemory.buffer.byteLength !== before)
          snapshot("operation-end", { method, beforeBytes: before, handleDelta: live - handles });
        operation = parent;
      }
    };
  }
  const initialize = engineModule ? (await import(pathToFileURL(resolve(engineModule)))).default : initCad;
  const wasmPath = engineWasm ? resolve(engineWasm) : require.resolve("replicad-opencascadejs/wasm");
  record.engineWasmSha256 = createHash("sha256").update(readFileSync(wasmPath)).digest("hex");
  record.engineLoaderSha256 = createHash("sha256").update(readFileSync(engineModule ? resolve(engineModule) : join(dirname(wasmPath), "replicad_single.js"))).digest("hex");
  record.runtimeResets = 0;
  let jobsSinceReset = 0;
  const freshRuntime = async () => {
    oc = await initialize({ locateFile: () => wasmPath, print: () => {}, printErr: () => {},
      // Optional callback in an explicitly supplied diagnostic loader only.
      onMemoryResizeRequest: (requestedBytes, beforeBytes) => snapshot("memory-request", { requestedBytes, beforeBytes }) });
    record.runtimeResets++;
    jobsSinceReset = 0;
    const grow = oc.wasmMemory.grow.bind(oc.wasmMemory);
    oc.wasmMemory.grow = pages => {
      const before = oc.wasmMemory.buffer.byteLength, value = grow(pages);
      snapshot("memory-grow", { beforeBytes: before, pages, handlesByType: Object.fromEntries([...kinds].filter(([, n]) => n > 0)) });
      return value;
    };
    if (flags.includes("--mesh") || flags.includes("--mixed")) {
      const extract = oc.ReplicadMeshExtractor.extract;
      let meshes = 0;
      const instrumentedExtract = function(...args) {
        const parent = operation;
        operation = `native mesh extraction ${++meshes}`;
        const before = oc.wasmMemory.buffer.byteLength;
        try {
          const result = extract.apply(this, args);
          snapshot("native-mesh", { beforeBytes: before, parameters: args.slice(1),
            vertices: result.getVerticesSize() / 3, triangles: result.getTrianglesSize() / 3 });
          return result;
        } finally { operation = parent; }
      };
      // Embind's overload dispatcher looks up its overloadTable on this static
      // method; preserve that dispatch metadata when wrapping it.
      oc.ReplicadMeshExtractor.extract = Object.assign(instrumentedExtract, extract);
    }
  };
  await freshRuntime();
  record.initialWasmBytes = oc.wasmMemory.buffer.byteLength;
  const progress = name => { phase = name; snapshot("phase", { handlesByType: Object.fromEntries([...kinds].filter(([, n]) => n > 0)) }); };
  for (let i = 0; i < repeat; i++) {
    if (i && (recycle === "dedicated" || (recycle === "unified" && (jobsSinceReset >= 8 || oc.wasmMemory.buffer.byteLength >= 256 * 1024 * 1024)))) await freshRuntime();
    const jobStart = performance.now();
    const method = flags.includes("--mixed") ? ["step", "preview", "mesh", "step"][i % 4] : flags.includes("--mesh") ? "mesh" : "step";
    const job = { number: i + 1, method, beforeBytes: oc.wasmMemory.buffer.byteLength };
    try {
      if (method !== "step") {
        const { buildCadBinMesh } = await load("client/src/lib/cad/mesh-build.ts");
        const { EXPORT_QUALITY, PREVIEW_QUALITY } = await load("client/src/lib/gridfinity/bin.ts");
        const result = buildCadBinMesh({ spec: project.spec, layout: project,
          quality: method === "preview" ? PREVIEW_QUALITY : EXPORT_QUALITY, exportTopology: method !== "preview" }, oc, progress);
        job.stats = result.stats;
        const digest = values => createHash("sha256").update(new Uint8Array(values.buffer, values.byteOffset, values.byteLength)).digest("hex");
        const meshRecord = mesh => ({ positionsSha256: digest(mesh.positions), indicesSha256: digest(mesh.indices), normalsSha256: mesh.normals && digest(mesh.normals),
          vertices: mesh.positions.length / 3, triangles: mesh.indices.length / 3 });
        job.meshes = { complete: meshRecord(result.mesh), body: result.bodyMesh && meshRecord(result.bodyMesh),
          text: result.textMeshes?.map(part => ({ id: part.label.id, ...meshRecord(part.mesh) })) };
      } else {
        const result = await exportStepPackage(project, oc, progress);
        job.report = result.report;
        if (i === 0) for (const [name, data] of Object.entries({ "cad.zip": result.bytes, ...unzipSync(result.bytes) })) writeFileSync(join(output, name), data);
      }
      job.status = "passed";
    } catch (error) { job.status = "failed"; job.error = String(error); }
    job.seconds = (performance.now() - jobStart) / 1000;
    job.afterBytes = oc.wasmMemory.buffer.byteLength;
    job.trackedHandlesAfterDispose = live;
    jobsSinceReset++;
    record.jobs.push(job); snapshot("job-end");
    console.log(JSON.stringify({ ...job, report: undefined }));
    if (job.status === "failed") { process.exitCode = 1; break; }
  }
  assert.deepEqual(readFileSync(resolve(input)), source, "The source file must remain unchanged");
} finally {
  record.seconds = (performance.now() - started) / 1000;
  record.peakWasmBytes = Math.max(0, ...record.events.map(event => event.wasmBytes));
  record.peakTrackedHandles = peakHandles;
  record.peakObservedRss = Math.max(0, ...record.events.map(event => event.rss));
  writeFileSync(join(output, "memory-profile.json"), JSON.stringify(record, null, 2));
  await server.close();
}
