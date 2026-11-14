// Local CPU/WASM evaluation only; never imported by the browser application.
const fs = require("node:fs");
const path = require("node:path");
(async () => {
  if (!process.argv[2]) throw new Error("Usage: node infer-teed.cjs <export-directory>");
  const dir = path.resolve(process.argv[2]);
  const start = performance.now();
  const cv = await require("../../client/public/opencv/opencv.js");
  const report = { node: process.version, initMs: performance.now() - start,
    heapBefore: cv.HEAPU8.buffer.byteLength, times: [] };
  const handles = [];
  const track = value => { handles.push(value); return value; };
  try {
    cv.FS.writeFile("/teed.onnx", fs.readFileSync(path.join(dir, "teed-512-fp32.onnx")));
    const imported = performance.now();
    const net = track(cv.readNetFromONNX("/teed.onnx"));
    report.importMs = performance.now() - imported;
    const input = track(cv.matFromArray(512, 512, cv.CV_8UC3, fs.readFileSync(path.join(dir, "input-bgr.bin"))));
    const blob = track(cv.blobFromImage(input, 1, new cv.Size(512, 512),
      new cv.Scalar(103.939, 116.779, 123.68, 0), false, false));
    net.setInput(blob);
    for (let i = 0; i < 4; i++) {
      const started = performance.now();
      const result = net.forward();
      report.times.push(performance.now() - started);
      try {
        if (i !== 0) continue;
        report.shape = Array.from(result.matSize);
        const actual = result.data32F;
        const bytes = fs.readFileSync(path.join(dir, "reference-f32.bin"));
        const expected = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
        if (actual.length !== expected.length) throw new Error("Output shape mismatch");
        let sum = 0, max = 0;
        for (let j = 0; j < actual.length; j++) {
          const error = Math.abs(actual[j] - expected[j]);
          if (!Number.isFinite(error)) throw new Error("Non-finite model output");
          sum += error; max = Math.max(max, error);
        }
        report.agreement = { meanAbsoluteError: sum / actual.length, maxAbsoluteError: max };
        if (max > 1e-4) throw new Error("OpenCV/PyTorch agreement failed");
        fs.writeFileSync(path.join(dir, "wasm-f32.bin"), Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength));
      } finally { result.delete(); }
    }
    report.heapAfter = cv.HEAPU8.buffer.byteLength;
    report.processMemory = process.memoryUsage();
  } finally {
    for (const handle of handles.reverse()) handle.delete();
    try { cv.FS.unlink("/teed.onnx"); } catch { /* Import may have failed before writing. */ }
  }
  fs.writeFileSync(path.join(dir, "inference.json"), JSON.stringify(report, null, 2));
  console.log(report);
})().catch(error => { console.error(String(error)); process.exitCode = 1; });
