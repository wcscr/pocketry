// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseProjectDoc } from "@shared/gridfinity/project";
import source from "@shared/gridfinity/fixtures/ryobi-split-reload.pocketry.json";
import { loadSampleLibrary, type SampleLibrary } from "@/lib/project/samples";
import { SampleLibraryDialog } from "./sample-library-dialog";

vi.mock("@/lib/project/samples", () => ({ loadSampleLibrary: vi.fn() }));
const sample = { id: "sample", name: "Ryobi cutter", updatedAt: "2026-10-08T12:00:00.000Z", doc: parseProjectDoc(source)! };
const library: SampleLibrary = { format: "pocketry-library", schemaVersion: 1, projects: [sample] };
let host: HTMLDivElement;
let root: Root;
const openSample = vi.fn();
const importAll = vi.fn();
const changed = vi.fn();
const render = async (open = true, busy = false) => React.act(async () => root.render(<SampleLibraryDialog open={open} busy={busy} onOpenChange={changed} onOpenSample={openSample} onImportAll={importAll} />));
const click = async (text: string) => React.act(async () => {
  [...document.querySelectorAll("button")].find(button => button.textContent === text)!.click();
});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.clearAllMocks();
  vi.mocked(loadSampleLibrary).mockResolvedValue(library);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await React.act(async () => { root.unmount(); await new Promise(resolve => setTimeout(resolve, 0)); });
  host.remove(); vi.unstubAllGlobals();
});
it("loads only when opened and leaves import decisions to the save guard", async () => {
  await render(false);
  expect(loadSampleLibrary).not.toHaveBeenCalled();
  await render();
  expect(document.querySelector('[aria-label="Sample projects"]')?.textContent).toContain("Ryobi cutter");
  expect(openSample).not.toHaveBeenCalled(); expect(importAll).not.toHaveBeenCalled();
  await click("Open"); expect(openSample).toHaveBeenCalledWith(sample);
  await click("Add all 1 projects to Library"); expect(importAll).toHaveBeenCalledWith(library);
});
it("shows a failed load and supports retry", async () => {
  vi.mocked(loadSampleLibrary).mockRejectedValueOnce(new Error("Offline"));
  await render();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Offline");
  await click("Try again");
  expect(document.querySelector('[aria-label="Sample projects"]')).not.toBeNull();
});
it("prevents closing or importing while an operation is pending", async () => {
  await render(true, true);
  await click("Open"); await click("Add all 1 projects to Library"); await click("Cancel"); await click("Close");
  expect(openSample).not.toHaveBeenCalled(); expect(importAll).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
});
