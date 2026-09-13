import { describe, expect, it } from "vitest";
import { BIN_HISTORY_LIMIT } from "./history";
import { parseProjectDoc } from "./project";
import fixture from "./fixtures/ryobi-split-reload.pocketry.json";

const project = parseProjectDoc(fixture)!;
const baseline = { spec: project.spec, cutouts: [], fingerHoles: [] };
const present = { spec: project.spec, cutouts: project.cutouts, fingerHoles: project.fingerHoles };
const history = { stack: [
  { doc: baseline, label: "Project opened" },
  { doc: present, label: "Add split pocket" },
  { doc: baseline, label: "Remove pocket" },
], index: 1 };
const saved = { ...project, history };

describe("portable project history", () => {
  it("round-trips labeled undo and redo states including split depths and finger access", () => {
    expect(parseProjectDoc(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });

  it("keeps shapes needed only by older states when the current pocket is deleted", () => {
    const deleted = { ...saved, ...baseline, history: { ...history, index: 2 } };
    expect(parseProjectDoc(deleted)).toEqual(deleted);
    expect(parseProjectDoc({ ...deleted, shapes: [] })).toBeNull();
  });

  it("opens v16 projects without inventing prior edits", () => {
    const legacy = { ...project, schemaVersion: 16 };
    expect(parseProjectDoc(legacy)).toEqual(project);
    expect(parseProjectDoc(legacy)?.history).toBeUndefined();
  });

  it.each([-1, 3, 0.5, 999])("rejects an invalid history position %s", (index) => {
    expect(parseProjectDoc({ ...saved, history: { ...history, index } })).toBeNull();
  });

  it("rejects mismatched current state, incomplete shapes and unknown history fields", () => {
    expect(parseProjectDoc({ ...saved, history: { ...history, index: 0 } })).toBeNull();
    expect(parseProjectDoc({ ...saved, shapes: [] })).toBeNull();
    expect(parseProjectDoc({ ...saved, shapes: [...saved.shapes, saved.shapes[0]] })).toBeNull();
    expect(parseProjectDoc({ ...saved, history: { ...history, schemaVersion: 999 } })).toBeNull();
    expect(parseProjectDoc({ ...saved, schemaVersion: 16 })).toBeNull();
  });

  it("validates every historical snapshot and bounds retention", () => {
    const invalid = { ...baseline, spec: { ...baseline.spec, gridX: -1 } };
    expect(parseProjectDoc({ ...saved, history: { ...history, stack: [
      { doc: invalid, label: "Invalid old step" }, history.stack[1],
    ] } })).toBeNull();
    const entries = Array.from({ length: BIN_HISTORY_LIMIT }, () => history.stack[1]);
    expect(parseProjectDoc({ ...saved, history: { stack: entries, index: 0 } })).not.toBeNull();
    expect(parseProjectDoc({ ...saved, history: { stack: [...entries, entries[0]], index: 0 } })).toBeNull();
    expect(parseProjectDoc({ ...saved, history: { stack: [], index: 0 } })).toBeNull();
  });
});
