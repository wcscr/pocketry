// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectBackupPrompt } from "./project-backup-prompt";
let host: HTMLDivElement;
let root: Root;
const save = vi.fn(async () => true);
const advance = vi.fn();
const cancel = vi.fn();
const projectExport = vi.fn();
const libraryExport = vi.fn();
const render = async () => React.act(async () => root.render(<ProjectBackupPrompt open busy={false} targetName="Example" replacesProject hasProject hasLibrary currentProjectName="My tools" onSave={save} onContinue={advance} onCancel={cancel} onExportProject={projectExport} onExportLibrary={libraryExport} />));
const click = async (text: string) => React.act(async () => { [...document.querySelectorAll("button")].find(button => button.textContent === text)!.click(); });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.clearAllMocks(); save.mockResolvedValue(true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await React.act(async () => { root.unmount(); await new Promise(resolve => setTimeout(resolve, 0)); });
  host.remove(); vi.unstubAllGlobals();
});
it("lets users save and export both backups before explicitly continuing", async () => {
  await render();
  await click("Save project to Library"); expect(save).toHaveBeenCalledWith("My tools");
  expect(document.querySelector('[role="status"]')?.textContent).toContain("Project saved");
  await click("Export current project"); await click("Export existing library");
  expect(projectExport).toHaveBeenCalledOnce(); expect(libraryExport).toHaveBeenCalledOnce();
  expect(advance).not.toHaveBeenCalled();
  await click("Open sample"); expect(advance).toHaveBeenCalledOnce();
});
it("keeps the choice open when saving fails and lets the user cancel", async () => {
  save.mockResolvedValue(false);
  await render(); await click("Save project to Library");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Could not save");
  expect(advance).not.toHaveBeenCalled();
  await click("Cancel"); expect(cancel).toHaveBeenCalledOnce();
});
it("blocks continuing while saving is in flight", async () => {
  let finish!: (value: boolean) => void;
  save.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await render(); await click("Save project to Library"); await click("Working…");
  expect(advance).not.toHaveBeenCalled();
  await React.act(async () => finish(true));
  expect(document.querySelector('[role="status"]')?.textContent).toContain("Project saved");
});
