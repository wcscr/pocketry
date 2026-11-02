import {
  EMPTY_PROJECT,
  binHistoryButton,
  clickBinHistory,
  flushHydration,
  experimentalSettings,
  openConstructionGroup,
  openSettingsSection,
  renderPage,
  setBinInterior,
} from "./bin-designer.test-support";
import * as React from "react";
import { expect, it, vi } from "vitest";
import { parseBinSpec } from "@shared/gridfinity/types";
import { DEFAULT_PEG_BOTTOM } from "@shared/gridfinity/peg-bottom";
import { useBinGeometry } from "@/lib/gridfinity/use-bin-geometry";
import * as ProjectPersistence from "@/lib/project/persist";

const contexts = [
  { layout: "standard", mobile: false }, { layout: "workflow", mobile: false },
  { layout: "standard", mobile: true }, { layout: "workflow", mobile: true },
] as const;
const groups = ["walls", "compartments", "floor", "base", "labels"] as const;
type Group = typeof groups[number];

function groupTrigger(container: HTMLElement, key: Group): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>(`[data-testid="construction-${key}-trigger"]`)!;
}
function groupBody(container: HTMLElement, key: Group): HTMLDivElement {
  return container.querySelector<HTMLDivElement>(`[data-testid="construction-${key}-body"]`)!;
}
/** Follow the same pane-opening route available on a phone before selecting a section. */
function openVisibleSection(container: HTMLElement, section: "construction" | "size", mobile: boolean): void {
  if (mobile) {
    const workflow = container.querySelector<HTMLElement>("#workflow-panel");
    const properties = container.querySelector<HTMLElement>(workflow ? "#objects-panel" : '[data-testid="mobile-properties-panel"]');
    if (workflow?.hidden || !workflow && properties?.hidden) {
      if (workflow && properties && !properties.hidden) {
        React.act(() => properties.querySelector<HTMLButtonElement>('[data-testid="button-back-to-canvas"]')!.click());
      }
      React.act(() => [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "Workflow")!.click());
    }
  }
  openSettingsSection(container, section);
}

function enterDraft(input: HTMLInputElement, value: string): void {
  expect(input.closest("[hidden]")).toBeNull();
  React.act(() => input.focus());
  React.act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it.each(contexts)("keeps Construction group choices outside model history in $layout (mobile: $mobile)", async ({ layout, mobile }) => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, "", `/bin?layout=${layout}`);
  const { container, unmount } = renderPage({ mobile, experimental: false });
  const current = () => vi.mocked(useBinGeometry).mock.lastCall![0];
  try {
    await flushHydration();
    openVisibleSection(container, "construction", mobile);
    const original = current();
    const interior = container.querySelector('[role="radiogroup"][aria-label="Interior"]')!;
    expect(interior.closest("[hidden]")).toBeNull();
    expect(interior.closest("[data-settings-disclosure]")).toBeNull();
    expect(container.querySelector('#bin-solid-fill')!.getAttribute("aria-checked")).toBe("true");
    expect(binHistoryButton(container, "undo").disabled).toBe(true);
    for (const key of groups) {
      expect(groupTrigger(container, key).getAttribute("aria-controls")).toBe(groupBody(container, key).id);
      expect(groupBody(container, key).hidden).toBe(key !== "walls");
      expect(groupBody(container, key).querySelector("[data-settings-disclosure]")).toBeNull();
    }
    expect(groupTrigger(container, "compartments").textContent).toContain("Available with Hollow interior");
    expect(groupTrigger(container, "floor").textContent).toContain("Available with Hollow interior");
    openConstructionGroup(container, "base");
    openConstructionGroup(container, "labels");
    React.act(() => groupTrigger(container, "walls").click());
    expect(groupBody(container, "base").hidden).toBe(false);
    expect(groupBody(container, "labels").hidden).toBe(false);
    expect(groupBody(container, "walls").hidden).toBe(true);
    openVisibleSection(container, "size", mobile);
    openVisibleSection(container, "construction", mobile);
    expect(groupBody(container, "base").hidden).toBe(false);
    expect(groupBody(container, "labels").hidden).toBe(false);
    expect(groupBody(container, "walls").hidden).toBe(true);
    expect(current()).toBe(original);
    expect(binHistoryButton(container, "undo").disabled).toBe(true);
  } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
});

it.each(contexts)("settles numeric edits once when collapsing a group in $layout (mobile: $mobile)", async ({ layout, mobile }) => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, "", `/bin?layout=${layout}`);
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
    spec: parseBinSpec({ ...EMPTY_PROJECT.spec, fill: "none", wallThicknessMm: null }) });
  const { container, unmount } = renderPage({ mobile, experimental: false });
  const current = () => vi.mocked(useBinGeometry).mock.lastCall![0];
  try {
    await flushHydration();
    openVisibleSection(container, "construction", mobile);
    const input = container.querySelector<HTMLInputElement>('#bin-wall-thickness')!;
    enterDraft(input, "2.4");
    React.act(() => groupTrigger(container, "walls").click());
    expect(groupBody(container, "walls").hidden).toBe(true);
    expect(groupBody(container, "walls").contains(input)).toBe(true);
    expect(document.activeElement).toBe(groupTrigger(container, "walls"));
    expect(current().wallThicknessMm).toBe(2.4);
    clickBinHistory(container, "undo");
    expect(current().wallThicknessMm).toBeNull();
    expect(binHistoryButton(container, "undo").disabled).toBe(true);
    clickBinHistory(container, "redo");
    openConstructionGroup(container, "walls");
    enterDraft(input, "3");
    enterDraft(input, "999");
    React.act(() => groupTrigger(container, "walls").click());
    expect(current().wallThicknessMm).toBe(2.4);
    expect(input.value).toBe("2.4");
    openConstructionGroup(container, "walls");
    expect(groupBody(container, "walls").textContent).toContain("Change not applied");
    enterDraft(input, "3");
    React.act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    React.act(() => groupTrigger(container, "walls").click());
    expect(current().wallThicknessMm).toBe(2.4);
    clickBinHistory(container, "undo");
    expect(current().wallThicknessMm).toBeNull();
    expect(binHistoryButton(container, "undo").disabled).toBe(true);
  } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
});

it.each(contexts)("retains inactive hollow settings while changing Interior in $layout (mobile: $mobile)", async ({ layout, mobile }) => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, "", `/bin?layout=${layout}`);
  const original = parseBinSpec({ ...EMPTY_PROJECT.spec, fill: "none", wallThicknessMm: 2.4,
    bottomFilletRadiusMm: 50, fillHeightPercent: 63,
    compartments: { enabled: false, rows: 3, columns: 2, dividerThicknessMm: 1.5, scoop: true } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec: original });
  const { container, unmount } = renderPage({ mobile, experimental: false });
  const current = () => vi.mocked(useBinGeometry).mock.lastCall![0];
  try {
    await flushHydration();
    openVisibleSection(container, "construction", mobile);
    openConstructionGroup(container, "compartments");
    openConstructionGroup(container, "floor");
    expect(container.querySelector('[aria-label="Internal compartments"]')!.getAttribute("aria-checked")).toBe("false");
    expect(container.querySelector('[aria-label="Scoop bottoms"]')!.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector<HTMLInputElement>('#bin-bottom-fillet')!.value).toBe("50");
    expect(groupBody(container, "floor").textContent).toContain("Limited to");
    setBinInterior(container, "solid");
    expect(current()).toEqual({ ...original, fill: "solid" });
    expect(container.querySelector('#bin-wall-thickness')).toBeNull();
    expect(container.querySelector('#bin-bottom-fillet')).toBeNull();
    expect(groupBody(container, "compartments").textContent).toContain("retained");
    expect(groupBody(container, "floor").textContent).toContain("retained");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Fill height percentage"]')!.value).toBe("63");
    setBinInterior(container, "none");
    expect(current()).toEqual(original);
    expect(groupBody(container, "compartments").hidden).toBe(false);
    expect(groupBody(container, "floor").hidden).toBe(false);
    expect(container.querySelector<HTMLInputElement>('#bin-bottom-fillet')!.value).toBe("50");
    clickBinHistory(container, "undo");
    expect(current()).toEqual({ ...original, fill: "solid" });
    clickBinHistory(container, "undo");
    expect(current()).toEqual(original);
    expect(binHistoryButton(container, "undo").disabled).toBe(true);
  } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
});


it.each(contexts)("explains retained fixture settings and reveals an available warning destination in $layout (mobile: $mobile)", async ({ layout, mobile }) => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, "", `/bin?layout=${layout}`);
  const original = parseBinSpec({ ...EMPTY_PROJECT.spec, heightUnits: 2, lip: "standard", pegBottom: DEFAULT_PEG_BOTTOM,
    labelTab: { wall: "north", width: "full", recessMm: 0.5, frontRim: true } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec: original });
  const { container, unmount } = renderPage({ mobile, experimental: false });
  const current = () => vi.mocked(useBinGeometry).mock.lastCall![0];
  try {
    await flushHydration();
    openVisibleSection(container, "construction", mobile);
    expect(groupBody(container, "base").hidden).toBe(false);
    expect(groupBody(container, "walls").hidden).toBe(true);
    openConstructionGroup(container, "walls");
    expect(groupBody(container, "walls").textContent).toContain("current interior and rim settings");
    expect(groupBody(container, "walls").textContent).toContain("Base & mounting");
    expect(groupTrigger(container, "walls").textContent).toContain("Stacking lip on");
    expect(container.querySelector('[role="switch"][aria-label="Stacking lip"]')).toBeNull();
    expect(container.querySelector('[role="switch"][aria-label="Slanted walls (prototype)"]')).toBeNull();
    expect(container.querySelector('[data-testid="construction-labels-trigger"]')).toBeNull();
    expect(groupBody(container, "base").textContent).toContain("Saved label tab settings");
    expect(groupBody(container, "base").textContent).toContain("Choose a flat bottom or Gridfinity feet");
    React.act(() => groupTrigger(container, "base").click());
    if (mobile) {
      const properties = container.querySelector<HTMLElement>(layout === "workflow" ? "#objects-panel" : '[data-testid="mobile-properties-panel"]')!;
      React.act(() => properties.querySelector<HTMLButtonElement>('[data-testid="button-back-to-canvas"]')!.click());
    }
    const canvas = container.querySelector('[data-testid="bin-viewport-stub"]');
    expect(canvas).not.toBeNull();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="canvas-warnings"] button[aria-expanded]')!.click());
    const warning = container.querySelector<HTMLButtonElement>('[data-issue-code="label-tab-clipped"]')!;
    expect(warning.closest("[hidden]")).toBeNull();
    React.act(() => warning.click());
    for (let frame = 0; frame < 6; frame++) {
      await React.act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
    }
    const target = container.querySelector('#select-bin-bottom')!;
    expect(target.closest("[hidden]")).toBeNull();
    expect(document.activeElement).toBe(target);
    expect(groupBody(container, "base").hidden).toBe(false);
    expect(groupBody(container, "base").textContent).toContain("Saved label tab settings");
    expect(container.querySelector('[data-testid="bin-viewport-stub"]')).toBe(canvas);
    expect(current()).toEqual(original);
    expect(experimentalSettings.enabled).toBe(false);
    expect(binHistoryButton(container, "undo").disabled).toBe(true);
  } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
});

it.each(contexts)("reports a restored slant with its actual stacking lip without normalizing it in $layout (mobile: $mobile)", async ({ layout, mobile }) => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, "", `/bin?layout=${layout}`);
  const original = parseBinSpec({ ...EMPTY_PROJECT.spec, lip: "standard", wallSlant: { axis: "x", angleDeg: -20 } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec: original });
  const { container, unmount } = renderPage({ mobile, experimental: false });
  const current = () => vi.mocked(useBinGeometry).mock.lastCall![0];
  try {
    await flushHydration();
    openVisibleSection(container, "construction", mobile);
    expect(groupTrigger(container, "walls").textContent).toContain("-20° slant");
    expect(groupTrigger(container, "walls").textContent).toContain("Stacking lip on");
    expect(groupTrigger(container, "walls").textContent).not.toContain("Flush rim");
    expect(groupBody(container, "walls").textContent).toContain("Slanted walls require a flush rim");
    expect(groupBody(container, "walls").textContent).toContain("Saved slant: -20°");
    const lip = container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Stacking lip"]')!;
    expect(lip.getAttribute("aria-checked")).toBe("true");
    expect(lip.disabled).toBe(true);
    expect(current()).toEqual(original);
    expect(experimentalSettings.enabled).toBe(false);
    expect(binHistoryButton(container, "undo").disabled).toBe(true);
  } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
});
