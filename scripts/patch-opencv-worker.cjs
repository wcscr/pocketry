// Packaging-only adaptation: ES modules have no top-level `this`. Keep the
// OpenCV implementation/WASM unchanged while making its UMD root worker-safe.
const fs = require("node:fs");
const file = process.argv[2];
const original = "}(this, function () {";
const replacement = "}(typeof globalThis !== 'undefined' ? globalThis : this, function () {";
const source = fs.readFileSync(file, "utf8");
if (source.includes(replacement)) process.exit(0);
if (source.split(original).length !== 2) throw new Error("Unexpected OpenCV UMD wrapper");
fs.writeFileSync(file, source.replace(original, replacement));
