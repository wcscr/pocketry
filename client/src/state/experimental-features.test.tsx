// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExperimentalFeaturesProvider, useExperimentalFeatures, EXPERIMENTAL_FEATURES_KEY, SELECTION_INSPECTOR_KEY, EDITOR_LAYOUT_KEY } from "./experimental-features";
import { PROJECT_SCHEMA_VERSION, type ProjectDoc } from "@shared/gridfinity/project";
import { parseBinSpec } from "@shared/gridfinity/types";
import { fingerHoleSchema } from "@shared/gridfinity/cutout";
import { ExperimentalFeaturesDialog } from "@/components/layout/experimental-features-dialog";

let state: ReturnType<typeof useExperimentalFeatures>;
const cleanup: (() => void)[] = [];
function mount() {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  function Probe() { state = useExperimentalFeatures(); return <ExperimentalFeaturesDialog />; }
  React.act(() => root.render(<ExperimentalFeaturesProvider><Probe /></ExperimentalFeaturesProvider>));
  const unmount = () => { React.act(() => root.unmount()); host.remove(); };
  cleanup.push(unmount);
  return unmount;
}
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); window.history.replaceState(null, "", "/"); });
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); window.history.replaceState(null, "", "/"); });

it("remembers the workflow preview across ordinary navigation and reloads, with a working Settings opt-out", () => {
  window.history.replaceState({ retained: true }, "", "/bin?layout=workflow&keep=yes#properties");
  mount();
  expect(state.inspectorEnabled).toBe(true);
  expect(state.enabled).toBe(false);
  expect(localStorage.getItem(EDITOR_LAYOUT_KEY)).toBe("workflow");
  expect(window.location.search).toBe("?keep=yes");
  expect(window.location.hash).toBe("#properties");
  expect(window.history.state).toEqual({ retained: true });
  for (const route of ["/", "/bin", "/about", "/bin"]) {
    React.act(() => window.history.pushState(null, "", route));
    expect(state.inspectorEnabled).toBe(true);
  }
  cleanup.pop()!(); mount();
  expect(state.inspectorEnabled).toBe(true);
  React.act(() => state.setSettingsOpen(true));
  React.act(() => document.querySelector<HTMLInputElement>('input[name="editor-layout"][value="standard"]')!.click());
  expect(state.inspectorEnabled).toBe(false);
  cleanup.pop()!(); mount();
  expect(state.inspectorEnabled).toBe(false);
});

it("applies layout links after the app mounts and supports an explicit return to the original layout", () => {
  mount(); expect(state.inspectorEnabled).toBe(false);
  React.act(() => window.history.pushState(null, "", "/bin?layout=workflow"));
  expect(state.inspectorEnabled).toBe(true);
  React.act(() => window.history.pushState(null, "", "/bin?layout=standard"));
  expect(state.inspectorEnabled).toBe(false);
  expect(localStorage.getItem(EDITOR_LAYOUT_KEY)).toBe("standard");
  expect(window.location.search).toBe("");
});

it("synchronizes the inspector choice across tabs without changing the experimental-tools preference", () => {
  mount(); localStorage.setItem(EDITOR_LAYOUT_KEY, "workflow");
  React.act(() => window.dispatchEvent(new StorageEvent("storage", { key: EDITOR_LAYOUT_KEY })));
  expect(state.inspectorEnabled).toBe(true); expect(state.enabled).toBe(false);
  localStorage.clear();
  React.act(() => window.dispatchEvent(new StorageEvent("storage", { key: null })));
  expect(state.inspectorEnabled).toBe(false);
});

it("retains the inspector during navigation when browser storage is blocked", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  window.history.replaceState(null, "", "/bin?layout=workflow");
  mount();
  React.act(() => window.history.pushState(null, "", "/"));
  React.act(() => window.history.pushState(null, "", "/bin"));
  expect(state.inspectorEnabled).toBe(true);
  expect(state.persistenceUnavailable).toBe(true);
  React.act(() => state.setEditorLayout("standard"));
  expect(state.inspectorEnabled).toBe(false);
});

it("defaults off, persists an explicit choice and restores it after remount", () => {
  mount(); expect(state.enabled).toBe(false);
  React.act(() => state.setSettingsOpen(true));
  const toggle = document.querySelector<HTMLButtonElement>('#experimental-features')!;
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  React.act(() => toggle.click());
  expect(state.enabled).toBe(true); expect(localStorage.getItem(EXPERIMENTAL_FEATURES_KEY)).toBe("true");
  cleanup.pop()!(); mount(); expect(state.enabled).toBe(true);
  React.act(() => state.setEnabled(false));
  cleanup.pop()!(); mount(); expect(state.enabled).toBe(false);
});

it("synchronizes a preference change or clear from another tab", () => {
  mount(); localStorage.setItem(EXPERIMENTAL_FEATURES_KEY, "true");
  React.act(() => window.dispatchEvent(new StorageEvent("storage", { key: EXPERIMENTAL_FEATURES_KEY })));
  expect(state.enabled).toBe(true);
  localStorage.clear();
  React.act(() => window.dispatchEvent(new StorageEvent("storage", { key: null })));
  expect(state.enabled).toBe(false);
});

it("keeps the option usable for the session when storage is blocked", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  mount(); expect(state.enabled).toBe(false);
  React.act(() => { state.setSettingsOpen(true); state.setEnabled(true); });
  expect(state.enabled).toBe(true);
  expect(document.querySelector('[role="status"]')?.textContent).toContain("this tab only");
});


it("enables only projects needing the tools, once per activation, without changing project data", () => {
  const ordinary: ProjectDoc = { schemaVersion: PROJECT_SCHEMA_VERSION, shapes: [],
    spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6 }), cutouts: [], fingerHoles: [] };
  const linked = { ...ordinary, fingerHoles: [fingerHoleSchema.parse({
    id: "access", center: { x: 0, y: 0 }, designLink: { id: "access-design" },
  })] };
  const before = structuredClone(linked);
  mount();
  expect(state.enableForProject(ordinary)).toBe(false);
  expect(state.enabled).toBe(false);
  React.act(() => {
    expect(state.enableForProject(linked)).toBe(true);
    expect(state.enableForProject(linked)).toBe(false);
  });
  expect(state.enabled).toBe(true);
  expect(localStorage.getItem(EXPERIMENTAL_FEATURES_KEY)).toBe("true");
  expect(linked).toEqual(before);
  React.act(() => state.setEnabled(false));
  expect(state.enabled).toBe(false);
  React.act(() => expect(state.enableForProject(linked)).toBe(true));
  expect(state.enabled).toBe(true);
});

it("defaults to Controls on the left and offers only the two supported layouts", () => {
  mount();
  expect(state.editorLayout).toBe("standard");
  expect(state.inspectorEnabled).toBe(false);
  React.act(() => state.setSettingsOpen(true));
  const choices = document.querySelectorAll<HTMLInputElement>('input[name="editor-layout"]');
  expect([...choices].map(choice => choice.value)).toEqual(["standard", "workflow"]);
  expect(choices[0].checked).toBe(true);
  expect(document.querySelector('[role="dialog"]')!.textContent).not.toContain("Objects left");
  expect(document.querySelector('#experimental-layout-recommendation')).toBeNull();
  const toggle = document.querySelector<HTMLButtonElement>('#experimental-features')!;
  React.act(() => toggle.click());
  expect(document.querySelector('#experimental-layout-recommendation')!.textContent).toContain("we recommend Workflow left, properties right");
  expect(state.editorLayout).toBe("standard");
  expect(choices[0].checked).toBe(true);
  React.act(() => choices[1].click());
  expect(state.editorLayout).toBe("workflow");
  React.act(() => toggle.click());
  expect(document.querySelector('#experimental-layout-recommendation')).toBeNull();
  expect(state.editorLayout).toBe("workflow");
  cleanup.pop()!(); mount();
  expect(state.editorLayout).toBe("workflow");
  expect(state.inspectorEnabled).toBe(true);
  React.act(() => window.history.pushState(null, "", "/bin?layout=standard&keep=yes#test"));
  expect(state.editorLayout).toBe("standard");
  expect(state.inspectorEnabled).toBe(false);
  expect(window.location.search).toBe("?keep=yes");
  expect(window.location.hash).toBe("#test");
});

it.each([null, "objects", "invalid"])("falls back to Controls on the left for retired or invalid saved layout %s", saved => {
  localStorage.setItem(SELECTION_INSPECTOR_KEY, "true");
  if (saved) localStorage.setItem(EDITOR_LAYOUT_KEY, saved);
  mount();
  expect(state.editorLayout).toBe("standard");
  expect(state.inspectorEnabled).toBe(false);
  React.act(() => state.setEditorLayout("workflow"));
  expect(localStorage.getItem(SELECTION_INSPECTOR_KEY)).toBeNull();
  cleanup.pop()!(); mount();
  expect(state.editorLayout).toBe("workflow");
});

it.each(["layout=objects", "inspector=1", "inspector=0"])("consumes retired preview link %s and returns to Controls on the left", query => {
  localStorage.setItem(EDITOR_LAYOUT_KEY, "workflow");
  window.history.replaceState({ retained: true }, "", `/bin?${query}&keep=yes#properties`);
  mount();
  expect(state.editorLayout).toBe("standard");
  expect(state.inspectorEnabled).toBe(false);
  expect(localStorage.getItem(EDITOR_LAYOUT_KEY)).toBe("standard");
  expect(window.location.search).toBe("?keep=yes");
  expect(window.location.hash).toBe("#properties");
  expect(window.history.state).toEqual({ retained: true });
});

it("prefers an explicit supported layout over the retired inspector flag", () => {
  window.history.replaceState(null, "", "/bin?layout=workflow&inspector=1");
  mount();
  expect(state.editorLayout).toBe("workflow");
  expect(window.location.search).toBe("");
});

it("restores workflow from a link and falls back when another tab stores the retired layout", () => {
  window.history.replaceState(null, "", "/bin?layout=workflow");
  mount();
  expect(state.editorLayout).toBe("workflow");
  expect(state.enabled).toBe(false);
  React.act(() => window.history.pushState(null, "", "/"));
  expect(state.editorLayout).toBe("workflow");
  localStorage.setItem(EDITOR_LAYOUT_KEY, "objects");
  React.act(() => window.dispatchEvent(new StorageEvent("storage", { key: EDITOR_LAYOUT_KEY })));
  expect(state.editorLayout).toBe("standard");
  expect(state.inspectorEnabled).toBe(false);
});
