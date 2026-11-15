/**
 * Development-only capture hooks for outline evaluation.
 *
 * Paste into the browser console of a local development build (or inject it from
 * an automated browser session) BEFORE loading a photo. Nothing here ships with
 * the app. The hooks record what Pocketry hands its detection worker, so an
 * offline evaluator can replay exactly what a user's flow produced:
 *
 *   1. load a photo and accept "Correct perspective & use scale";
 *   2. draw a region closely around one tool, as a user would;
 *   3. `await pocketryCapture.save("s18-rub-n-buff", { title: "..." })`.
 *
 * Saved files go to the loopback receiver in capture-receiver.mjs:
 *   <name>.rgba          the exact RGBA pixels sent to the worker
 *   <name>.json          detection options, the app's own result, region, calibration
 *   <name>.working.png   the calibrated photo the region was drawn on
 */
(() => {
  if (window.pocketryCapture) return;
  const RECEIVER = "http://127.0.0.1:5311/save";
  const DRAFT_KEY = "pocketry:trace-draft:v1";
  const state = { last: null, count: 0, errors: [] };

  // The worker protocol is { id, kind: "call", method, payload }; results come back by id.
  const postMessage = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (message, transfer) {
    try {
      if (message && message.kind === "call" && message.method === "detect") {
        const image = message.payload.image;
        // Copy before the buffer is transferred to the worker.
        const record = {
          id: message.id, width: image.width, height: image.height,
          data: new Uint8Array(image.data.buffer.slice(image.data.byteOffset, image.data.byteOffset + image.data.byteLength)),
          options: JSON.parse(JSON.stringify(message.payload.options)), sent: performance.now(),
        };
        state.last = record; state.count++;
        if (!this.__pocketryCapture) {
          this.__pocketryCapture = true;
          this.addEventListener("message", (event) => {
            const reply = event.data, current = state.last;
            if (!reply || !current || reply.id !== current.id) return;
            if (reply.kind === "result") { current.result = reply.payload; current.ms = performance.now() - current.sent; }
            if (reply.kind === "error") { current.error = reply.error; current.ms = performance.now() - current.sent; }
          });
        }
      }
    } catch (error) { state.errors.push(String(error)); }
    return postMessage.apply(this, arguments);
  };

  async function post(file, body, type) {
    const response = await fetch(`${RECEIVER}?file=${encodeURIComponent(file)}`, { method: "POST", body, headers: { "content-type": type } });
    if (!response.ok) throw new Error(`Could not save ${file}: ${response.status}`);
    return (await response.json()).bytes;
  }
  /** The browser-local Trace draft (idb-keyval's default database). */
  async function readDraft() {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open("keyval-store"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try {
      return await new Promise((resolve, reject) => { const q = db.transaction("keyval").objectStore("keyval").get(DRAFT_KEY); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
    } finally { db.close(); }
  }
  const APP_FIELDS = ["fileName", "imageSize", "imageRotation", "imageAlignment", "calibration", "calibrationSource", "region",
    "perspectiveCorrection", "sensitivity", "includeInteriorHoles", "boundaryMethod", "editableCurves", "tolerancePx", "smoothing",
    "margin", "outline", "rawOutline", "estimatedEdgeRegions", "detectionHints"];

  /**
   * Saves the most recent completed detection as a case.
   * `extra.skipWorking` skips the calibrated photo (use it for a second tool on the same photo);
   * `extra.workingName` names that shared photo.
   */
  async function save(name, extra = {}) {
    const record = state.last;
    if (!record || (!record.result && !record.error)) throw new Error("No completed detection to save");
    const draft = await readDraft();
    const trace = draft && draft.state;
    if (!trace) throw new Error("No Trace draft found");
    const app = Object.fromEntries(APP_FIELDS.map((key) => [key, trace[key]]));
    const { skipWorking, ...described } = extra;
    const meta = {
      name, capturedAt: new Date().toISOString(), userAgent: navigator.userAgent, detectionComplete: draft.detectionComplete,
      detect: { width: record.width, height: record.height, options: record.options, ms: record.ms, result: record.result ?? null, error: record.error ?? null },
      app, ...described,
    };
    const bytes = { rgba: await post(`${name}.rgba`, record.data, "application/octet-stream"), json: await post(`${name}.json`, JSON.stringify(meta), "application/json") };
    if (!skipWorking) bytes.working = await post(extra.workingName ?? `${name}.working.png`, await (await fetch(trace.imageUrl)).blob(), "application/octet-stream");
    return { name, bytes, region: trace.region, crop: `${record.width}x${record.height}` };
  }

  window.pocketryCapture = { state, save, readDraft };
})();
