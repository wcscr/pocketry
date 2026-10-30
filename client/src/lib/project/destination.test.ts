import { expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION, type ProjectDoc } from "@shared/gridfinity/project";
import { parseBinSpec } from "@shared/gridfinity/types";
import { DEFAULT_BIN_MATERIALS } from "@shared/gridfinity/materials";
import { projectDestinationKey } from "./destination";

const doc: ProjectDoc = { schemaVersion: PROJECT_SCHEMA_VERSION, spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6 }), shapes: [], cutouts: [], fingerHoles: [] };

it("keeps named identity stable through edits and distinguishes different drafts", () => {
  const edited = { ...doc, spec: { ...doc.spec, gridX: 5 } };
  expect(projectDestinationKey(doc, "a")).toBe(projectDestinationKey(edited, "a"));
  expect(projectDestinationKey(doc, "a")).not.toBe(projectDestinationKey(doc, "b"));
  expect(projectDestinationKey(doc, null)).not.toBe(projectDestinationKey(edited, null));
  expect(projectDestinationKey(doc, null)).not.toBe(projectDestinationKey(null, null));
});

it("normalizes hydration defaults and a history baseline without treating them as a different draft", () => {
  const hydrated = { ...doc, keepBinSize: false, materials: DEFAULT_BIN_MATERIALS, transformOrigins: { pockets: [], fingerHoles: [] } };
  expect(projectDestinationKey(hydrated, null)).toBe(projectDestinationKey(doc, null));
  expect(projectDestinationKey(JSON.parse(JSON.stringify(hydrated)), null)).toBe(projectDestinationKey(doc, null));
  expect(projectDestinationKey({ ...hydrated, history: { stack: [{ doc: { spec: doc.spec, cutouts: [], fingerHoles: [] }, label: "Project opened" }], index: 0 } }, null)).toBe(projectDestinationKey(doc, null));
});
