/** Recheck stored outlines after a source-only annotation review; no inference.
 * Args: final prepared cases.json, evaluation directory.
 * Timings and actual detector outputs are preserved.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { auditOutlinePair } from "./white-sheet-audit";
const cases = JSON.parse(readFileSync(process.argv[2], "utf8"));
const root = resolve(process.argv[3]), summary = JSON.parse(readFileSync(resolve(root, "summary.json"), "utf8"));
summary.cases = cases.map((c: { name: string }) => {
  const path = resolve(root, c.name + ".json");
  const record = JSON.parse(readFileSync(path, "utf8"));
  const { path: _privatePath, source: _privateSource, ...metadata } = c as unknown as Record<string, unknown>;
  Object.assign(record, metadata);
  record.audit = auditOutlinePair(record, record.before, record.after);
  writeFileSync(path, JSON.stringify(record));
  const { before, after, beforeSilhouette: _a, afterSilhouette: _b, ...row } = record;
  return { ...row, beforeStatus: before.refinement, afterStatus: after.refinement };
});
writeFileSync(resolve(root, "summary.json"), JSON.stringify(summary, null, 2));
console.log("Rechecked", summary.cases.length, "paired outline audits");
