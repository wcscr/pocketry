// Local-only helper: copy the calibration-sheet photos from the maintainer's photo
// library into the dev server's ignored public folder under short names, and record
// the mapping with source hashes. Nothing here is committed.
// Usage: node stage-photos.mjs <photo-library-dir> <public-dest-dir> <mapping.json>
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

const [library, dest, mapping] = process.argv.slice(2);
mkdirSync(dest, { recursive: true });
const files = readdirSync(library)
  .filter(name => /\.(jpe?g|png)$/i.test(name) && name.includes("ON Pocketry sheet"))
  .sort((a, b) => a.localeCompare(b));
const rows = files.map((name, i) => {
  const id = `p${String(i + 1).padStart(2, "0")}`;
  const served = id + extname(name).toLowerCase().replace("jpeg", "jpg");
  const bytes = readFileSync(join(library, name));
  copyFileSync(join(library, name), join(dest, served));
  return { id, served, sourceFile: name, sourceSha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
});
writeFileSync(mapping, JSON.stringify(rows, null, 2) + "\n");
for (const r of rows) console.log(r.id, r.sourceFile);
