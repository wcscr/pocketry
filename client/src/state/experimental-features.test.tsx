// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExperimentalFeaturesProvider, useExperimentalFeatures, EXPERIMENTAL_FEATURES_KEY } from "./experimental-features";
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
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); });
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

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
