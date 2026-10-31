import {
  binGeometryMock,
  projectToast,
  EMPTY_PROJECT,
  rectangularShape,
  flushHydration,
  experimentalSettings,
  renderPage,
  openSettingsSection,
  openUltim8Setup,
  enterJigThickness,
  jigDialogButton,
  clickBinHistory,
  selectPocket,
} from "./bin-designer.test-support";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { parseProjectDoc } from "@shared/gridfinity/project";
import { DEFAULT_BIN_MATERIALS } from "@shared/gridfinity/materials";
import { fingerHoleSchema, resolvePocketDepth, parseCutoutPlacement } from "@shared/gridfinity/cutout";
import { MAX_HEIGHT_UNITS, parseBinSpec } from "@shared/gridfinity/types";
import { binWallThicknessMm } from "@shared/gridfinity/standard";
import { generateUltim8JigSVG } from "@/lib/export/layout";
import { DEFAULT_PEG_BOTTOM } from "@shared/gridfinity/peg-bottom";
import { downloadBlob } from "@/lib/download";
import { useBinGeometry } from "@/lib/gridfinity/use-bin-geometry";
import { footprintOuterRingMm, occupiedCellCount } from "@shared/gridfinity/footprint";
import * as ProjectPersistence from "@/lib/project/persist";

describe("BinDesignerPage", () => {
  it.each(["standard", "workflow"])("retains hollow bottom fillets through edits, undo, fill and reload in %s layout", async layout => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const page = renderPage({ experimental: false });
    const { container } = page;
    let unmount = page.unmount;
    try {
      await flushHydration();
      openSettingsSection(container, "construction");
      const field = () => container.querySelector<HTMLInputElement>('[aria-label="Bottom edge fillet in millimetres"]');
      const current = () => vi.mocked(useBinGeometry).mock.lastCall![0];
      const toggle = (label: string) => React.act(() => container.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${label}"]`)!.click());
      const enter = (value: string) => {
        React.act(() => {
          field()!.focus();
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field(), value);
          field()!.dispatchEvent(new Event("input", { bubbles: true }));
        });
        React.act(() => field()!.blur());
      };
      expect(field()).toBeNull();
      toggle("Solid fill");
      expect(field()!.value).toBe("0");
      enter("3");
      expect(current().bottomFilletRadiusMm).toBe(3);
      clickBinHistory(container, "undo");
      expect(field()!.value).toBe("0");
      clickBinHistory(container, "redo");
      expect(field()!.value).toBe("3");
      for (const label of ["Scoop bottoms", "Internal compartments", "Internal compartments"]) toggle(label);
      expect(field()!.value).toBe("3");
      React.act(() => experimentalSettings.setEnabled(true));
      toggle("Slanted walls (prototype)");
      React.act(() => experimentalSettings.setEnabled(false));
      expect(field()!.disabled).toBe(false);
      expect(current()).toMatchObject({ bottomFilletRadiusMm: 3, compartments: { enabled: false, scoop: true }, wallSlant: { angleDeg: 20 } });
      enter("50");
      expect(field()!.value).toBe("50");
      expect(container.querySelector('[data-testid="bottom-fillet-controls"]')!.textContent).toContain("Limited to");
      toggle("Solid fill");
      expect(field()).toBeNull();
      expect(current().bottomFilletRadiusMm).toBe(50);
      toggle("Solid fill");
      expect(field()!.value).toBe("50");
      enter("0");
      expect(current().bottomFilletRadiusMm).toBe(0);
      clickBinHistory(container, "undo");
      const saved = parseProjectDoc({ ...EMPTY_PROJECT, spec: current() })!;
      expect(saved).not.toBeNull();
      unmount();
      unmount = () => {};
      vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(saved);
      const reopened = renderPage({ experimental: false });
      unmount = reopened.unmount;
      await flushHydration();
      openSettingsSection(reopened.container, "construction");
      expect(reopened.container.querySelector<HTMLInputElement>('[aria-label="Bottom edge fillet in millimetres"]')!.value).toBe("50");
      expect(current().compartments.scoop).toBe(true);
    } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
  });

  it.each(["standard", "workflow"])("edits compartments and scoops with undo and retained fill settings in %s layout", async layout => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const { container, unmount } = renderPage({ experimental: false });
    try {
      await flushHydration();
      openSettingsSection(container, "construction");
      const input = (label: string) => container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
      const toggle = (label: string) => React.act(() => container.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${label}"]`)!.click());
      const enter = (label: string, value: string) => {
        React.act(() => {
          input(label).focus();
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(label), value);
          input(label).dispatchEvent(new Event("input", { bubbles: true }));
        });
        React.act(() => input(label).blur());
      };
      const controls = () => container.querySelector('[data-testid="internal-compartment-controls"]');
      const disclosure = () => container.querySelector<HTMLDivElement>('[data-testid="compartment-settings"]');
      expect(controls()).toBeNull();
      expect(container.querySelector('[aria-label="Scoop bottoms"]')).toBeNull();
      toggle("Solid fill");
      expect(container.querySelector('[aria-label="Internal compartments"]')!.getAttribute("aria-checked")).toBe("false");
      expect(disclosure()).toBeNull();
      expect(controls()!.querySelector('[aria-label="Scoop bottoms"]')).toBeNull();
      toggle("Scoop bottoms");
      expect(container.querySelector('[aria-label="Internal compartments"]')!.getAttribute("aria-checked")).toBe("false");
      toggle("Scoop bottoms");
      toggle("Internal compartments");
      expect(disclosure()!.hidden).toBe(true);
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="compartment-settings-trigger"]')!.click());
      expect(disclosure()!.hidden).toBe(false);
      expect(controls()!.querySelector('p')).toBeNull();
      enter("Sub-bin rows", "2"); enter("Sub-bin columns", "3");
      enter("Divider thickness in millimetres", "1.5"); toggle("Scoop bottoms");
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].compartments).toEqual({ enabled: true, rows: 2, columns: 3, dividerThicknessMm: 1.5, scoop: true });
      clickBinHistory(container, "undo");
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].compartments.scoop).toBe(false);
      clickBinHistory(container, "redo");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="compartment-settings-trigger"]')!.click());
      expect(disclosure()!.hidden).toBe(true);
      toggle("Internal compartments");
      expect(disclosure()).toBeNull();
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].compartments).toEqual({ enabled: false, rows: 2, columns: 3, dividerThicknessMm: 1.5, scoop: true });
      clickBinHistory(container, "undo");
      expect(disclosure()).not.toBeNull();
      clickBinHistory(container, "redo");
      expect(disclosure()).toBeNull();
      toggle("Internal compartments");
      toggle("Solid fill");
      expect(controls()).toBeNull();
      expect(container.querySelector('[aria-label="Scoop bottoms"]')).toBeNull();
      toggle("Solid fill");
      expect(disclosure()!.hidden).toBe(true);
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="compartment-settings-trigger"]')!.click());
      expect(input("Sub-bin rows").value).toBe("2");
      expect(input("Sub-bin columns").value).toBe("3");
      expect(container.querySelector('[aria-label="Scoop bottoms"]')!.getAttribute("aria-checked")).toBe("true");
      expect(container.querySelector('[data-testid="experimental-design-notice"]')).toBeNull();
      enter("Sub-bin rows", "0");
      expect(input("Sub-bin rows").value).toBe("2");
      React.act(() => experimentalSettings.setEnabled(true));
      toggle("Slanted walls (prototype)");
      expect(container.textContent).not.toContain("Dividers follow the wall slant");
      expect(container.querySelector('[aria-label="About internal compartments"]')).not.toBeNull();
      expect(container.querySelector('[aria-label="About scoop bottoms"]')).not.toBeNull();
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].compartments.scoop).toBe(true);
    } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
  });


  it.each(["standard", "workflow"])("gates one-axis wall slant behind experimental opt-in in %s layout", async layout => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const { container, unmount } = renderPage({ experimental: false });
    try {
      await flushHydration();
      openSettingsSection(container, "construction");
      const toggle = () => container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Slanted walls (prototype)"]');
      const angle = () => container.querySelector<HTMLInputElement>('[aria-label="Wall angle in degrees"]');
      expect(toggle()).toBeNull();
      expect(angle()).toBeNull();
      expect(container.querySelector('[aria-label="Walls to tilt"]')).toBeNull();
      React.act(() => experimentalSettings.setEnabled(true));
      React.act(() => toggle()!.click());
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toMatchObject({
        wallSlant: { axis: "y", angleDeg: 20 }, lip: "none",
      });
      expect(container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Stacking lip"]')!.disabled).toBe(true);
      const disclosure = container.querySelector<HTMLDivElement>('[data-testid="wall-slant-settings"]')!;
      expect(disclosure.hidden).toBe(true);
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="wall-slant-settings-trigger"]')!.click());
      expect(disclosure.hidden).toBe(false);
      expect(angle()?.value).toBe("20");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="wall-slant-settings-trigger"]')!.click());
      expect(disclosure.hidden).toBe(true);
      expect(angle()?.value).toBe("20");
      expect(angle()?.min).toBe("-89");
      expect(angle()?.max).toBe("89");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toMatchObject({ wallSlant: null, lip: "standard" });
      clickBinHistory(container, "redo");
      React.act(() => experimentalSettings.setEnabled(false));
      expect(toggle()).toBeNull();
      expect(angle()).toBeNull();
      expect(container.querySelector('[aria-label="Wall slant axis"]')).toBeNull();
      expect(container.querySelector('[aria-label="Walls to tilt"]')).toBeNull();
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toMatchObject({ wallSlant: { axis: "y", angleDeg: 20 }, lip: "none" });
      expect(container.querySelector('[data-testid="experimental-design-notice"]')!.textContent).toContain("slanted walls");
      React.act(() => experimentalSettings.setEnabled(true));
      expect(angle()?.value).toBe("20");
    } finally {
      unmount();
      window.history.replaceState(null, "", originalUrl);
    }
  });

  it.each(["standard", "workflow"])("selects a single tilted wall with undo and axis-aware labels in %s layout", async layout => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "construction");
      expect(container.querySelector('[aria-label="Walls to tilt"]')).toBeNull();
      React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Slanted walls (prototype)"]')!.click());
      React.act(() => container.querySelector('[data-testid="wall-slant-settings-trigger"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      const choose = (field: string, label: string) => {
        React.act(() => container.querySelector<HTMLButtonElement>(`[aria-label="${field}"]`)!.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
        React.act(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === label)!.click());
      };
      choose("Walls to tilt", "Back only (+Y)");
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].wallSlant).toMatchObject({ axis: "y", side: "positive", angleDeg: 20 });
      clickBinHistory(container, "undo");
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].wallSlant?.side).toBeUndefined();
      clickBinHistory(container, "redo");
      expect(container.querySelector('[aria-label="Walls to tilt"]')!.textContent).toContain("Back only (+Y)");
      choose("Wall slant axis", "Width (X)");
      expect(container.querySelector('[aria-label="Walls to tilt"]')!.textContent).toContain("Right only (+X)");
      choose("Walls to tilt", "Left only (−X)");
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].wallSlant).toMatchObject({ axis: "x", side: "negative", angleDeg: 20 });
      const angle = container.querySelector<HTMLInputElement>('[aria-label="Wall angle in degrees"]')!;
      React.act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(angle, "75");
        angle.dispatchEvent(new Event("input", { bubbles: true }));
      });
      React.act(() => angle.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].wallSlant?.angleDeg).toBe(75);
      React.act(() => experimentalSettings.setEnabled(false));
      expect(container.querySelector('[aria-label="Walls to tilt"]')).toBeNull();
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].wallSlant?.side).toBe("negative");
    } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
  });

  it.each([
    { tilt: { xDeg: 0, yDeg: 30 }, role: undefined, expected: { axis: "x", angleDeg: 30 } },
    { tilt: { xDeg: 0, yDeg: 75 }, role: undefined, expected: { axis: "x", angleDeg: 75 } },
    { tilt: { xDeg: -30, yDeg: 0 }, role: undefined, expected: { axis: "y", angleDeg: 30 } },
    { tilt: { xDeg: 20, yDeg: 30 }, role: undefined, expected: null },
    { tilt: { xDeg: 0, yDeg: 30 }, role: "hole" as const, expected: null },
  ])("matches slanted walls only to a pocket leaning along one bin axis: %o", async ({ tilt, role, expected }) => {
    const shape = rectangularShape("slanted-source", "Tilted tool");
    const pocket = parseCutoutPlacement({ id: "tilted", shapeId: shape.id, position: { x: 0, y: 0 }, tilt, role,
      depth: { mode: "mm", value: 10 } });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [pocket],
      spec: parseBinSpec({ ...EMPTY_PROJECT.spec, lip: "none", wallSlant: { axis: "y", angleDeg: 20, side: "positive" } }) });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "tool-cutouts");
      selectPocket(container, pocket.id);
      openSettingsSection(container, "construction");
      React.act(() => container.querySelector<HTMLElement>('[data-testid="wall-slant-settings-trigger"]')!.click());
      const match = [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Match selected pocket angle");
      if (expected) {
        expect(match).toBeDefined();
        React.act(() => match!.click());
        const slant = vi.mocked(useBinGeometry).mock.lastCall![0].wallSlant!;
        expect(slant.axis).toBe(expected.axis);
        expect(slant.angleDeg).toBeCloseTo(expected.angleDeg, 8);
        expect(slant.side).toBe("positive");
      } else expect(match).toBeUndefined();
    } finally { unmount(); }
  });

  it.each([false, true])("preserves opt-out for restored slanted walls, including history-only=%s", async historyOnly => {
    const spec = parseBinSpec({ ...EMPTY_PROJECT.spec, lip: "none", wallSlant: { axis: "x", angleDeg: -30 } });
    const doc = { spec, cutouts: [], fingerHoles: [] };
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      spec: historyOnly ? EMPTY_PROJECT.spec : spec,
      history: { index: historyOnly ? 1 : 0, stack: [
        { doc, label: "Slanted walls" }, { doc: { ...doc, spec: EMPTY_PROJECT.spec }, label: "Upright walls" },
      ] },
    });
    const { container, unmount } = renderPage({ experimental: false });
    try {
      await flushHydration();
      expect(experimentalSettings.enabled).toBe(false);
      expect(container.querySelector('[data-testid="experimental-design-notice"]') === null).toBe(historyOnly);
      if (historyOnly) React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      openSettingsSection(container, "construction");
      expect(experimentalSettings.enabled).toBe(false);
      expect(container.querySelector('[aria-label="Wall angle in degrees"]')).toBeNull();
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toMatchObject({ wallSlant: { axis: "x", angleDeg: -30 } });
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="experimental-design-notice"] button')!.click());
      expect(container.querySelector<HTMLInputElement>('[aria-label="Wall angle in degrees"]')?.value).toBe("-30");
    } finally { unmount(); }
  });

  it.each([false, true])("offers checked-by-default fixed-depth adjustment under Construction fill height (experimental=%s)", async experimental => {
    const pocket = parseCutoutPlacement({ id: "fixed", shapeId: "s", position: { x: 0, y: 0 }, depth: { mode: "mm", value: 20 } });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [rectangularShape("s", "Fixed")], cutouts: [pocket] });
    const { container, unmount } = renderPage({ experimental });
    try {
      await flushHydration();
      openSettingsSection(container, "construction");
      const construction = container.querySelector("#bin-settings-construction")!;
      const checkbox = construction.querySelector<HTMLButtonElement>('#adjust-fixed-pocket-depths')!;
      expect(checkbox.getAttribute("data-state")).toBe("checked");
      expect(construction.querySelector('label[for="adjust-fixed-pocket-depths"]')?.textContent).toBe("Adjust fixed pocket depths");
      expect(construction.querySelector('[data-testid="fill-height-control"]')!.compareDocumentPosition(checkbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const setFill = (value: string) => {
        const input = construction.querySelector<HTMLInputElement>('[aria-label="Fill height percentage"]')!;
        React.act(() => {
          input.focus();
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        React.act(() => input.blur());
      };
      setFill("75");
      const adjusted = vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0];
      expect(resolvePocketDepth({ ...EMPTY_PROJECT.spec, fillHeightPercent: 75 }, adjusted.depth).floorZ).toBeCloseTo(20.8, 9);
      React.act(() => checkbox.click());
      expect(checkbox.getAttribute("data-state")).toBe("unchecked");
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0].depth).toEqual(pocket.depth);
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].fillHeightPercent).toBe(75);
      React.act(() => checkbox.click());
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0]).toEqual(adjusted);
      React.act(() => checkbox.click());
      setFill("100");
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0].depth).toEqual(pocket.depth);
      React.act(() => checkbox.click());
      setFill("25");
      expect(construction.querySelector('[role="alert"]')?.textContent).toContain("no depth");
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].fillHeightPercent).toBe(100);
      expect(construction.querySelector<HTMLInputElement>('[aria-label="Fill height percentage"]')!.value).toBe("100");
    } finally { unmount(); }
  });

  it("adjusts fill percentages with exact typing and keyboard, retaining the value while hollow", async () => {
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "construction");
    const input = () => container.querySelector<HTMLInputElement>('[aria-label="Fill height percentage"]')!;
    const dimensions = container.querySelector("#bin-settings-size")!.textContent;
    expect(input().value).toBe("100");
    React.act(() => {
      input().focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), "37.5");
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    React.act(() => input().blur());
    expect(input().value).toBe("37.5");
    expect(vi.mocked(useBinGeometry).mock.lastCall?.[0].fillHeightPercent).toBe(37.5);
    React.act(() => {
      input().focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), "50");
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    React.act(() => input().blur());
    const thumb = container.querySelector<HTMLElement>('[role="slider"][aria-label="Fill height"]')!;
    React.act(() => thumb.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(input().value).toBe("51");
    const toggle = () => container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Solid fill"]')!;
    React.act(() => toggle().click());
    expect(input()).toBeNull();
    React.act(() => toggle().click());
    expect(input().value).toBe("51");
    expect(container.querySelector("#bin-settings-size")!.textContent).toBe(dimensions);
    unmount();
  });

  it.each(["standard", "workflow"])("edits hollow walls directly without experimental tools in %s layout", async layout => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const { container, unmount } = renderPage({ experimental: false });
    try {
      await flushHydration();
      openSettingsSection(container, "construction");
      const field = () => container.querySelector<HTMLInputElement>('[aria-label="Wall thickness in millimetres"]');
      const toggle = () => container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Solid fill"]')!;
      expect(field()).toBeNull();
      React.act(() => toggle().click());
      expect(field()!.value).toBe("0.95");
      expect(container.querySelector('[aria-label="Override wall thickness"]')).toBeNull();
      expect(field()!.disabled).toBe(false);
      React.act(() => {
        field()!.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field(), "2.4");
        field()!.dispatchEvent(new Event("input", { bubbles: true }));
      });
      React.act(() => field()!.blur());
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toMatchObject({ fill: "none", wallThicknessMm: 2.4 });
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(field()!.value).toBe("0.95");
      clickBinHistory(container, "redo");
      expect(field()!.value).toBe("2.4");
      React.act(() => toggle().click());
      expect(field()).toBeNull();
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toMatchObject({ fill: "solid", wallThicknessMm: 2.4 });
      React.act(() => toggle().click());
      expect(field()!.value).toBe("2.4");
      React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="About wall thickness"]')!.click());
      expect(document.querySelector('[role="tooltip"]')!.textContent).toContain("Thicker walls grow inward");
      React.act(() => experimentalSettings.setEnabled(true));
      React.act(() => experimentalSettings.setEnabled(false));
      expect(field()!.value).toBe("2.4");
      expect(field()!.disabled).toBe(false);
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toMatchObject({ fill: "none", wallThicknessMm: 2.4 });
      expect(container.querySelector('[data-testid="experimental-design-notice"]')).toBeNull();
    } finally {
      unmount();
      window.history.replaceState(null, "", originalUrl);
    }
  });

  it.each(["standard", "workflow"])("restores legacy defaults to automatic walls until directly edited in %s layout", async layout => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(parseProjectDoc({
      ...EMPTY_PROJECT, schemaVersion: 48,
      spec: { ...EMPTY_PROJECT.spec, fill: "none", wallThicknessMm: 0.95 },
    }));
    const { container, unmount } = renderPage({ experimental: false });
    const current = () => vi.mocked(useBinGeometry).mock.lastCall![0];
    const field = () => container.querySelector<HTMLInputElement>('[aria-label="Wall thickness in millimetres"]')!;
    const reset = () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Use recommended")!;
    const enter = (label: string, value: string) => {
      const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
      React.act(() => input.focus());
      React.act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      React.act(() => input.blur());
    };
    try {
      await flushHydration();
      openSettingsSection(container, "construction");
      expect(current().wallThicknessMm).toBeNull();
      for (const [height, thickness] of [["8", 1.2], ["15.5", 1.2], ["16", 1.6], ["7.5", 0.95], ["20", 1.6]] as const) {
        openSettingsSection(container, "size");
        enter("Bin height in units", height);
        expect(current().wallThicknessMm).toBeNull();
        expect(binWallThicknessMm(current())).toBe(thickness);
        openSettingsSection(container, "construction");
        expect(field().value).toBe(String(thickness));
        expect(field().disabled).toBe(false);
        expect(reset()).toBeUndefined();
        expect(container.querySelector('[data-testid="experimental-design-notice"]')).toBeNull();
      }
      expect(container.textContent).toContain("Recommended · follows bin height");
      expect(field().disabled).toBe(false);
      enter("Wall thickness in millimetres", "0.95");
      openSettingsSection(container, "size");
      enter("Bin height in units", "30");
      expect(binWallThicknessMm(current())).toBe(0.95);
      openSettingsSection(container, "construction");
      React.act(() => reset().click());
      expect(current().wallThicknessMm).toBeNull();
      expect(binWallThicknessMm(current())).toBe(1.6);
      expect(reset()).toBeUndefined();
      clickBinHistory(container, "undo");
      expect(current().wallThicknessMm).toBe(0.95);
      expect(field().disabled).toBe(false);
      clickBinHistory(container, "redo");
      expect(current().wallThicknessMm).toBeNull();
      expect(reset()).toBeUndefined();
      expect(experimentalSettings.enabled).toBe(false);
      expect(container.querySelector('[data-testid="experimental-design-notice"]')).toBeNull();
    } finally {
      unmount();
      window.history.replaceState(null, "", originalUrl);
    }
  });

  it.each([false, true])("restores custom walls as standard controls, including history-only=%s", async historyOnly => {
    const spec = parseBinSpec({ ...EMPTY_PROJECT.spec, fill: "none", wallThicknessMm: 2.4 });
    const doc = { spec, cutouts: [], fingerHoles: [] };
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      spec: historyOnly ? EMPTY_PROJECT.spec : spec,
      history: { index: historyOnly ? 1 : 0, stack: [
        { doc, label: "Thicker walls" }, { doc: { ...doc, spec: EMPTY_PROJECT.spec }, label: "Default walls" },
      ] },
    });
    const { container, unmount } = renderPage({ experimental: false });
    try {
      await flushHydration();
      expect(experimentalSettings.enabled).toBe(false);
      expect(projectToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Experimental features enabled" }));
      expect(container.querySelector('[data-testid="experimental-design-notice"]')).toBeNull();
      if (historyOnly) React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      openSettingsSection(container, "construction");
      expect(experimentalSettings.enabled).toBe(false);
      expect(container.querySelector<HTMLInputElement>('[aria-label="Wall thickness in millimetres"]')!.value).toBe("2.4");
      expect(container.querySelector<HTMLInputElement>('[aria-label="Wall thickness in millimetres"]')!.disabled).toBe(false);
      expect(container.querySelector('[aria-label="Override wall thickness"]')).toBeNull();
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toMatchObject({ fill: "none", wallThicknessMm: 2.4 });
    } finally { unmount(); }
  });

  it.each(["standard", "workflow"])("warns after committed thin-wall edits and higher recommendation bands in %s layout", async layout => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, spec: { ...EMPTY_PROJECT.spec, fill: "none", heightUnits: 16, wallThicknessMm: null },
    });
    const { container, unmount } = renderPage({ experimental: false });
    const current = () => vi.mocked(useBinGeometry).mock.lastCall![0];
    const field = () => container.querySelector<HTMLInputElement>('[aria-label="Wall thickness in millimetres"]')!;
    const warnings = () => projectToast.mock.calls.filter(([message]) => message.title === "Wall thickness below recommendation");
    const draft = (input: HTMLInputElement, value: string) => {
      React.act(() => input.focus());
      React.act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    try {
      await flushHydration();
      openSettingsSection(container, "construction");
      expect(warnings()).toHaveLength(0);
      draft(field(), "1.2");
      expect(warnings()).toHaveLength(0);
      React.act(() => field().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(current().wallThicknessMm).toBeNull();
      expect(warnings()).toHaveLength(0);
      draft(field(), "1.2");
      React.act(() => field().blur());
      expect(current().wallThicknessMm).toBe(1.2);
      expect(warnings()).toHaveLength(1);
      expect(warnings()[0][0].description).toContain("recommended 1.6 mm");
      expect(warnings()[0][0].description).toContain("16U");
      draft(field(), "0.5");
      React.act(() => field().blur());
      expect(current().wallThicknessMm).toBe(1.2);
      expect(warnings()).toHaveLength(1);
      for (const [height, warningCount] of [["8", 1], ["16", 2], ["20", 2]] as const) {
        openSettingsSection(container, "size");
        const heightInput = container.querySelector<HTMLInputElement>('[aria-label="Bin height in units"]')!;
        draft(heightInput, height);
        React.act(() => heightInput.blur());
        expect(warnings()).toHaveLength(warningCount);
      }
      openSettingsSection(container, "construction");
      for (const thickness of ["2", "1.6"]) {
        draft(field(), thickness);
        React.act(() => field().blur());
        expect(warnings()).toHaveLength(2);
      }
      expect(container.querySelector('[role="slider"][aria-label="Wall thickness"]')).toBeNull();
      draft(field(), "1.55");
      React.act(() => field().blur());
      expect(current().wallThicknessMm).toBe(1.55);
      expect(warnings()).toHaveLength(3);
      React.act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Use recommended")!.click());
      expect(current().wallThicknessMm).toBeNull();
      expect(field().value).toBe("1.6");
      expect(warnings()).toHaveLength(3);
    } finally {
      unmount();
      window.history.replaceState(null, "", originalUrl);
    }
  });

  it("toggles flat bottoms without resizing and restores base hole preferences", async () => {
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "construction");
    const control = (label: string) => container.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${label}"]`)!;
    const dimensions = container.querySelector("#bin-settings-size")!.textContent;
    React.act(() => control("Magnet holes").click());
    expect(control("Magnet holes").getAttribute("aria-checked")).toBe("true");
    const chooseBottom = (label: string) => {
      const trigger = container.querySelector<HTMLButtonElement>('[data-testid="select-bin-bottom"]')!;
      React.act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
      React.act(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === label)!.click());
    };
    chooseBottom("Flat bottom");
    expect(vi.mocked(useBinGeometry).mock.lastCall?.[0].flatBottom).toBe(true);
    expect(control("Magnet holes")).toBeNull();
    expect(control("Screw holes")).toBeNull();
    expect(container.querySelector("#bin-settings-size")!.textContent).toBe(dimensions);
    chooseBottom("Gridfinity feet");
    expect(control("Magnet holes").getAttribute("aria-checked")).toBe("true");
    unmount();
  });

  it.each(["standard", "workflow"])("requires Experimental to create Wham Bam Systems ULTIM8-compatible pegs in the %s layout", async layout => {
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const { container, unmount } = renderPage({ experimental: false });
    await flushHydration();
    try {
      openSettingsSection(container, "construction");
      const trigger = () => container.querySelector<HTMLButtonElement>('[data-testid="select-bin-bottom"]')!;
      React.act(() => trigger().dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
      const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];
      expect(options().map(o => o.textContent)).toEqual(["Gridfinity feet", "Flat bottom"]);
      React.act(() => options().find(o => o.textContent === "Flat bottom")!.click());
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].flatBottom).toBe(true);
      React.act(() => experimentalSettings.setEnabled(true));
      React.act(() => trigger().dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
      React.act(() => options().find(o => o.textContent === "Wham Bam Systems ULTIM8-compatible pegs")!.click());
      enterJigThickness("8.5");
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].pegBottom).toBeNull();
      React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === "Keep current settings")!.click());
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].pegBottom?.underside).toBe("flat");
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].arbitrarySizeMm).toBeNull();
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].heightUnits).toBe(6);
      const group = container.querySelector('[role="group"][aria-label="Wham Bam Systems ULTIM8 peg settings"]')!;
      expect(group.getAttribute("data-property-tone")).toBe("rose");
      expect(group.hasAttribute("data-property-surface")).toBe(true);
      for (const label of ["Peg underside", "Peg density", "Peg diameter in millimetres", "Peg length in millimetres"]) {
        expect(group.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
      }
      expect(group.contains(trigger())).toBe(false);
      expect(group.querySelector('[aria-label="Peg underside"]')!.textContent).toBe("Flat backing · pegs up");
      expect(group.querySelector('[aria-label="Peg density"]')!.textContent).toBe("Corners only");
    } finally { unmount(); }
  });

  it.each([
    ["standard", "rectangle"], ["workflow", "rectangle"],
    ["standard", "custom"], ["workflow", "custom"],
  ] as const)("confirms ULTIM8 jig settings without changing a cancelled design in the %s layout (%s)", async (layout, footprint) => {
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const original = parseBinSpec({ ...EMPTY_PROJECT.spec, fill: "none", fillHeightPercent: 55, textColor: "#fedcba",
      ...(footprint === "custom" ? { footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] } } : {}) });
    const materials = { ...DEFAULT_BIN_MATERIALS, binColor: "#123456", pocketFloorColor: "#abcdef", stackingRimColor: "#654321" };
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec: original, materials });
    binGeometryMock.hasPocketFloor = true;
    const { container, unmount } = renderPage();
    await flushHydration();
    const current = () => vi.mocked(useBinGeometry).mock.lastCall![0];
    const viewport = () => container.querySelector('[data-testid="bin-viewport-stub"]')!;
    const choosePegs = () => {
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="select-bin-bottom"]')!
        .dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
      React.act(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === "Wham Bam Systems ULTIM8-compatible pegs")!.click());
    };
    const respond = (label: string) => React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === label)!.click());
    try {
      openSettingsSection(container, "construction");
      choosePegs();
      const prompt = document.querySelector('[role="alertdialog"]')!.textContent!;
      expect(prompt).toContain("set Solid fill to 100%");
      expect(prompt.includes("switch Grid pitch to Arbitrary")).toBe(footprint === "rectangle");
      expect(current()).toEqual(original);
      expect(document.querySelector<HTMLInputElement>('[aria-label="Jig body thickness in millimetres"]')!.value).toBe("42");
      enterJigThickness("8.5");
      expect(jigDialogButton("Use jig settings").disabled).toBe(footprint === "custom");
      respond("Cancel");
      expect(current()).toEqual(original);
      expect(viewport().getAttribute("data-rim-color")).toBe(materials.stackingRimColor);
      expect(viewport().getAttribute("data-text-color")).toBe(original.textColor);
      choosePegs();
      respond("Use jig settings");
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      expect(current()).toMatchObject({ lip: "none", fill: "solid", fillHeightPercent: 100, flatBottom: false,
        pegBottom: { underside: "flat", density: "corners" }, textColor: null,
        arbitrarySizeMm: footprint === "rectangle" ? { width: 83.5, length: 83.5 } : null });
      expect(current().heightUnits).toBe(original.heightUnits);
      expect(current().footprint).toEqual(original.footprint);
      openSettingsSection(container, "size");
      expect(container.querySelector('[aria-label="Grid pitch"]')).toBeNull();
      if (footprint === "rectangle") {
        expect(container.querySelector<HTMLInputElement>('[aria-label="Fixture width in millimetres"]')!.value).toBe("83.5");
        expect(container.querySelector<HTMLInputElement>('[aria-label="Fixture length in millimetres"]')!.value).toBe("83.5");
        expect(container.querySelector<HTMLInputElement>('[aria-label="Fixture body thickness in millimetres"]')!.value).toBe("42");
      }
      for (const region of ["bin", "floor", "rim", "text"]) expect(viewport().getAttribute(`data-${region}-color`)).toBe(materials.binColor);
      expect(viewport().getAttribute("data-pocket-floor-color")).toBe("off");
      expect(viewport().getAttribute("data-stacking-rim-color")).toBe("off");
      openSettingsSection(container, "project");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-export-project"]')!.click());
      const [blob] = vi.mocked(downloadBlob).mock.lastCall!;
      const json = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
      const exported = parseProjectDoc(JSON.parse(json))!;
      expect(exported.spec).toEqual(current());
      expect(exported.materials).toEqual({ ...materials, colorPocketFloors: false, colorStackingRim: false,
        pocketFloorColor: materials.binColor, stackingRimColor: materials.binColor });
      expect(exported.history!.stack[exported.history!.index].materialChange?.before).toEqual(materials);
      clickBinHistory(container, "undo");
      expect(current()).toEqual(original);
      expect(viewport().getAttribute("data-rim-color")).toBe(materials.stackingRimColor);
      expect(viewport().getAttribute("data-text-color")).toBe(original.textColor);
      expect(viewport().getAttribute("data-pocket-floor-color")).toBe("on");
      expect(viewport().getAttribute("data-stacking-rim-color")).toBe("on");
      clickBinHistory(container, "redo");
      for (const region of ["bin", "floor", "rim", "text"]) expect(viewport().getAttribute(`data-${region}-color`)).toBe(materials.binColor);
    } finally { unmount(); }
  });

  it.each(["standard", "workflow"])("edits and exports ULTIM8 jig body thickness with undo in the %s layout", async layout => {
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const original = parseBinSpec({ ...EMPTY_PROJECT.spec, heightUnits: 3, lip: "none", flatBottom: true });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec: original });
    const { container, unmount } = renderPage(); await flushHydration();
    const current = () => vi.mocked(useBinGeometry).mock.lastCall![0];
    try {
      openUltim8Setup(container);
      expect(document.querySelector<HTMLInputElement>('[aria-label="Jig body thickness in millimetres"]')!.value).toBe("21");
      for (const value of ["", "1.9", "421"]) {
        enterJigThickness(value);
        expect(jigDialogButton("Use jig settings").disabled).toBe(true);
        expect(document.querySelector('[role="alertdialog"] [role="alert"]')!.textContent).toContain("body thickness");
        expect(current()).toEqual(original);
      }
      enterJigThickness("8.5");
      expect(jigDialogButton("Use jig settings").disabled).toBe(false);
      expect(current()).toEqual(original);
      React.act(() => jigDialogButton("Use jig settings").click());
      const jig = current();
      expect(jig.heightUnits * 7).toBe(8.5);
      expect(jig.pegBottom).toMatchObject({ underside: "flat", density: "corners", lengthMm: 4 });
      expect(jig.arbitrarySizeMm).toEqual({ width: 83.5, length: 83.5 });
      openSettingsSection(container, "project");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-export-project"]')!.click());
      const [blob] = vi.mocked(downloadBlob).mock.lastCall!;
      const json = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
      expect(parseProjectDoc(JSON.parse(json))!.spec).toEqual(jig);
      clickBinHistory(container, "undo");
      expect(current()).toEqual(original);
      clickBinHistory(container, "redo");
      expect(current()).toEqual(jig);
    } finally { unmount(); }
  });

  it.each(["standard", "workflow"])("checks ULTIM8 jig thickness before clamping finger access in the %s layout", async layout => {
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const original = parseBinSpec({ ...EMPTY_PROJECT.spec, heightUnits: 3, lip: "none", flatBottom: true });
    const finger = fingerHoleSchema.parse({ id: "access", kind: "flat-ended-scoop", center: { x: 0, y: 0 }, diameterMm: 11.4, lengthMm: 30, depthMm: 4 });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec: original, fingerHoles: [finger] });
    const { container, unmount } = renderPage(); await flushHydration();
    try {
      openUltim8Setup(container);
      enterJigThickness("3");
      expect(jigDialogButton("Use jig settings").disabled).toBe(true);
      expect(document.querySelector('[role="alertdialog"] [role="alert"]')!.textContent).toContain("Finger access 1 is deeper than the bin itself");
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toEqual(original);
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.fingerHoles[0].depthMm).toBe(4);
      enterJigThickness("4.5");
      expect(jigDialogButton("Use jig settings").disabled).toBe(false);
      expect(document.querySelector('[aria-label="Jig thickness warnings"]')!.textContent).toContain("0.5 mm floor");
      React.act(() => jigDialogButton("Use jig settings").click());
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].heightUnits * 7).toBe(4.5);
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.fingerHoles[0].depthMm).toBe(4);
    } finally { unmount(); }
  });

  it.each(["standard", "workflow"])("checks fixed pocket adjustment before applying ULTIM8 thickness in the %s layout", async layout => {
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const original = parseBinSpec({ ...EMPTY_PROJECT.spec, heightUnits: 3, lip: "none", flatBottom: true });
    const shape = rectangularShape("tool", "Tool");
    const pocket = parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 }, depth: { mode: "mm", value: 10 } });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec: original, shapes: [shape], cutouts: [pocket] });
    const { container, unmount } = renderPage(); await flushHydration();
    try {
      openUltim8Setup(container);
      enterJigThickness("8.5");
      expect(jigDialogButton("Use jig settings").disabled).toBe(true);
      expect(document.querySelector('[role="alertdialog"] [role="alert"]')!.textContent).toContain("fixed pocket with no depth");
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toEqual(original);
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0].depth).toEqual(pocket.depth);
      enterJigThickness("14");
      expect(jigDialogButton("Use jig settings").disabled).toBe(false);
      React.act(() => jigDialogButton("Use jig settings").click());
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].heightUnits * 7).toBe(14);
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0].depth).toEqual({ mode: "mm", value: 3 });
    } finally { unmount(); }
  });

  it.each(["standard", "workflow"])("edits restored Wham Bam Systems ULTIM8-compatible pegs without enabling other experimental tools in the %s layout", async layout => {
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const spec = parseBinSpec({ ...EMPTY_PROJECT.spec, lip: "none", heightUnits: 8.5 / 7,
      arbitrarySizeMm: { width: 159.4, length: 75 }, pegBottom: { underside: "flat", density: "corners", lengthMm: 3.5 } });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec });
    const { container, unmount } = renderPage({ experimental: false });
    await flushHydration();
    try {
      openSettingsSection(container, "construction");
      const current = () => vi.mocked(useBinGeometry).mock.lastCall![0];
      expect(experimentalSettings.enabled).toBe(false);expect(current().pegBottom).toEqual(spec.pegBottom);
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      expect(container.querySelector('[aria-label="Wham Bam Systems ULTIM8 peg settings"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="select-bin-bottom"]')!.textContent).toBe("Wham Bam Systems ULTIM8-compatible pegs");
      for (const label of ["Peg underside", "Peg density", "Peg diameter in millimetres"]) expect(container.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
      expect(container.querySelector('[data-testid="experimental-design-notice"]')).toBeNull();
      expect(container.querySelector('[aria-label="Slanted walls (prototype)"]')).toBeNull();
      expect(experimentalSettings.enabled).toBe(false);
      const diameter = container.querySelector<HTMLInputElement>('[aria-label="Peg diameter in millimetres"]')!;
      React.act(() => { diameter.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(diameter,"4.6");diameter.dispatchEvent(new Event("input", { bubbles: true })); });
      React.act(() => diameter.blur());
      React.act(() => experimentalSettings.setEnabled(false));
      expect(current().pegBottom).toEqual({ ...spec.pegBottom!, diameterMm: 4.6 });
      expect(current().arbitrarySizeMm).toEqual(spec.arbitrarySizeMm);expect(current().heightUnits).toBe(spec.heightUnits);
      expect(container.querySelector('[aria-label="Peg diameter in millimetres"]')).not.toBeNull();
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(experimentalSettings.enabled).toBe(false);expect(current().pegBottom).toEqual(spec.pegBottom);
    } finally { unmount(); }
  });

  it.each(["standard", "workflow"])("edits Wham Bam Systems ULTIM8-compatible peg bottoms, restores base holes, and undoes fit edits in the %s layout", async layout => {
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const { container, unmount } = renderPage();
    await flushHydration();
    try {
      openSettingsSection(container, "construction");
      const choose = (label: string) => {
        const trigger = container.querySelector<HTMLButtonElement>('[data-testid="select-bin-bottom"]')!;
        React.act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
        React.act(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === label)!.click());
      };
      const magnet = () => container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Magnet holes"]');
      React.act(() => magnet()!.click());
      choose("Wham Bam Systems ULTIM8-compatible pegs");
      React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === "Keep current settings")!.click());
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].lip).toBe("standard");
      expect(container.querySelector('[data-testid="bin-viewport-stub"]')!.getAttribute("data-stacking-rim-color")).toBe("on");
      expect(magnet()).toBeNull();
      expect(container.textContent).not.toContain("For Wham Bam ULTIM8 mats");
      await React.act(async () => container.querySelector<HTMLButtonElement>('[aria-label="About bottom"]')!.click());
      expect(document.querySelector('[role="tooltip"]')!.textContent).toContain("Wham Bam Systems ULTIM8-compatible pegs for the eufyMake E1 mat");
      expect(document.querySelector('[role="tooltip"]')!.textContent).toContain("4.0 mm below the fixture");
      React.act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(vi.mocked(useBinGeometry).mock.lastCall?.[0].pegBottom).toEqual({ diameterMm: 4.8, lengthMm: 4, underside: "flat", density: "corners" });
      const input = () => container.querySelector<HTMLInputElement>('[aria-label="Peg diameter in millimetres"]')!;
      React.act(() => {
        input().focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), "4.6");
        input().dispatchEvent(new Event("input", { bubbles: true }));
      });
      React.act(() => input().blur());
      expect(vi.mocked(useBinGeometry).mock.lastCall?.[0].pegBottom?.diameterMm).toBe(4.6);
      const undo = container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!;
      React.act(() => undo.click());
      expect(input().value).toBe("4.8");
      const underside = container.querySelector<HTMLButtonElement>('[aria-label="Peg underside"]')!;
      React.act(() => underside.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
      React.act(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === "Short bridges")!.click());
      expect(vi.mocked(useBinGeometry).mock.lastCall?.[0].pegBottom?.underside).toBe("bridged");
      expect(container.textContent).not.toContain("Short bridges join the flared peg collars");
      await React.act(async () => container.querySelector<HTMLButtonElement>('[aria-label="About underside"]')!.click());
      expect(document.querySelector('[role="tooltip"]')!.textContent).toContain("Short bridges join the flared peg collars");
      React.act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      React.act(() => undo.click());
      expect(vi.mocked(useBinGeometry).mock.lastCall?.[0].pegBottom?.underside).toBe("flat");
      choose("Gridfinity feet");
      expect(container.querySelector('[aria-label="Wham Bam Systems ULTIM8 peg settings"]')).toBeNull();
      expect(magnet()!.getAttribute("aria-checked")).toBe("true");
      expect(vi.mocked(useBinGeometry).mock.lastCall?.[0].pegBottom).toBeNull();
      choose("Flat bottom");
      expect(vi.mocked(useBinGeometry).mock.lastCall?.[0].flatBottom).toBe(true);
    } finally { unmount(); }
  });

  it.each(["standard", "workflow"] as const)("restores Gridfinity feet after arbitrary sizes with undo and redo in the %s layout", async layout => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const { container, unmount } = renderPage({ experimental: false });
    await flushHydration();
    const current = () => vi.mocked(useBinGeometry).mock.lastCall![0];
    const choosePitch = (label: string) => {
      openSettingsSection(container, "size");
      React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Grid pitch"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
      React.act(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === label)!.click());
    };
    const expectBottom = (label: string) => {
      openSettingsSection(container, "construction");
      expect(container.querySelector('[aria-label="Bottom"]')!.textContent).toBe(label);
    };
    try {
      const original = current();
      expect(original.flatBottom).toBe(false);
      for (const label of ["Full · 42 mm", "Half · 21 mm", "Quarter · 10.5 mm"]) {
        choosePitch("Arbitrary · no Gridfinity");
        const arbitrary = current();
        expect(arbitrary.arbitrarySizeMm).not.toBeNull();
        expect(arbitrary.flatBottom).toBe(true);
        expectBottom("Flat bottom (automatic)");
        choosePitch(label);
        const restored = current();
        expect(restored).toMatchObject({ arbitrarySizeMm: null, flatBottom: false, pegBottom: null });
        expect(footprintOuterRingMm(restored)).toEqual(footprintOuterRingMm(original));
        expect(restored.heightUnits).toBe(original.heightUnits);
        expectBottom("Gridfinity feet");
        clickBinHistory(container, "undo");
        expect(current()).toEqual(arbitrary);
        expectBottom("Flat bottom (automatic)");
        clickBinHistory(container, "redo");
        expect(current()).toEqual(restored);
        expectBottom("Gridfinity feet");
      }
    } finally {
      unmount();
      window.history.replaceState(null, "", originalUrl);
    }
  });

  it.each(["standard", "workflow"] as const)("preserves explicit bottoms selected before or during arbitrary sizing in the %s layout", async layout => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const { container, unmount } = renderPage();
    await flushHydration();
    const current = () => vi.mocked(useBinGeometry).mock.lastCall![0];
    const choose = (section: "size" | "construction", field: string, label: string) => {
      openSettingsSection(container, section);
      React.act(() => container.querySelector<HTMLButtonElement>(`[aria-label="${field}"]`)!.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
      React.act(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === label)!.click());
      if (label === "Wham Bam Systems ULTIM8-compatible pegs") React.act(() => jigDialogButton("Keep current settings").click());
    };
    try {
      for (const bottom of ["Flat bottom", "Wham Bam Systems ULTIM8-compatible pegs"]) {
        for (const when of ["before", "during"]) {
          choose("construction", "Bottom", "Gridfinity feet");
          if (when === "before") choose("construction", "Bottom", bottom);
          if (current().pegBottom) {
            openSettingsSection(container, "size");
            expect(container.querySelector('[aria-label="Grid pitch"]')).toBeNull();
            const width = container.querySelector<HTMLInputElement>('[aria-label="Fixture width in millimetres"]')!;
            React.act(() => { width.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(width, "125.5"); width.dispatchEvent(new Event("input", { bubbles: true })); });
            React.act(() => width.blur());
          } else choose("size", "Grid pitch", "Arbitrary · no Gridfinity");
          if (when === "during") {
            expect(current().autoFlatBottom).toBe(true);
            choose("construction", "Bottom", bottom);
            expect(current().autoFlatBottom).toBe(false);
            clickBinHistory(container, "undo");
            expect(current().autoFlatBottom).toBe(true);
            clickBinHistory(container, "redo");
          }
          const chosen = current();
          expect(chosen.autoFlatBottom).toBe(false);
          if (chosen.pegBottom) {
            expect(chosen.flatBottom).toBe(false);
            openSettingsSection(container, "size");
            expect(container.querySelector('[aria-label="Grid pitch"]')).toBeNull();
            // Fixture dimensions use mm; returning to a regular flat bottom exposes grid choices again.
            choose("construction", "Bottom", "Flat bottom");
            choose("size", "Grid pitch", "Full · 42 mm");
            expect(current()).toMatchObject({ arbitrarySizeMm: null, flatBottom: true, autoFlatBottom: false, pegBottom: null });
            continue;
          }
          for (const pitch of ["Full · 42 mm", "Half · 21 mm", "Quarter · 10.5 mm"]) {
            choose("size", "Grid pitch", pitch);
            expect(current().arbitrarySizeMm).toBeNull();
            expect(current().flatBottom).toBe(chosen.flatBottom);
            expect(current().pegBottom).toEqual(chosen.pegBottom);
            openSettingsSection(container, "construction");
            expect(container.querySelector('[aria-label="Bottom"]')!.textContent).toBe(bottom);
            clickBinHistory(container, "undo");
            expect(current()).toEqual(chosen);
          }
          choose("size", "Grid pitch", "Full · 42 mm");
        }
      }
    } finally {
      unmount();
      window.history.replaceState(null, "", originalUrl);
    }
  });

  it.each(["standard", "workflow"] as const)("shows Arbitrary sizes as fixed and explains arrange overflow in the %s layout", async layout => {
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const shape = rectangularShape("tool", "Oversized tool");
    const spec = parseBinSpec({ ...EMPTY_PROJECT.spec, flatBottom: true, arbitrarySizeMm: { width: 10, length: 10 } });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec, keepBinSize: false,
      shapes: [shape], cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 } })] });
    const { container, unmount } = renderPage(); await flushHydration();
    try {
      openSettingsSection(container, "size");
      const fixed = container.querySelector<HTMLButtonElement>('[aria-label="Keep bin size fixed"]')!;
      expect(fixed.getAttribute("aria-checked")).toBe("true");
      expect(fixed.disabled).toBe(true);
      openSettingsSection(container, "tool-cutouts");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-auto-arrange"]')!.click());
      expect(projectToast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Does not fit", description: expect.stringContaining("bin size is fixed") }));
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].arbitrarySizeMm).toEqual({ width: 10, length: 10 });
      // Returning to a matching grid restores the prior user preference.
      openSettingsSection(container, "size");
      for (const axis of ["width", "length"]) {
        const input = container.querySelector<HTMLInputElement>(`[aria-label="Bin ${axis} in millimetres"]`)!;
        React.act(() => { input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "83.5"); input.dispatchEvent(new Event("input", { bubbles: true })); });
        React.act(() => input.blur());
      }
      React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Grid pitch"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
      React.act(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === "Full · 42 mm")!.click());
      const restored = container.querySelector<HTMLButtonElement>('[aria-label="Keep bin size fixed"]')!;
      expect(restored.disabled).toBe(false);
      expect(restored.getAttribute("aria-checked")).toBe("false");
    } finally { unmount(); }
  });

  it("explains a queued tool overflowing an Arbitrary bin as a fixed-size layout", async () => {
    sessionStorage.setItem("pocketry:queued-tools", JSON.stringify([rectangularShape("tool", "Oversized tool")]));
    const spec = parseBinSpec({ ...EMPTY_PROJECT.spec, flatBottom: true, arbitrarySizeMm: { width: 10, length: 10 } });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec, keepBinSize: false });
    const { unmount } = renderPage();
    try {
      await flushHydration();
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].arbitrarySizeMm).toEqual({ width: 10, length: 10 });
      expect(projectToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Tool does not fit", description: expect.stringContaining("bin size is fixed") }));
    } finally { unmount(); }
  });

  it.each(["standard", "workflow"] as const)("formats fitted millimetre sizes without changing precision in the %s layout", async layout => {
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const shape = rectangularShape("tool", "Tool");
    const cutout = parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 }, scaleX: 1.123456789, scaleY: 1.234567891 });
    const spec = parseBinSpec({ ...EMPTY_PROJECT.spec, flatBottom: true, arbitrarySizeMm: { width: 83.5, length: 83.5 } });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec, shapes: [shape], cutouts: [cutout] });
    const { container, unmount } = renderPage(); await flushHydration();
    try {
      openSettingsSection(container, "size");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-fit-bin"]')!.click());
      const fitted = vi.mocked(useBinGeometry).mock.lastCall![0].arbitrarySizeMm!;
      const width = container.querySelector<HTMLInputElement>('[aria-label="Bin width in millimetres"]')!;
      const length = container.querySelector<HTMLInputElement>('[aria-label="Bin length in millimetres"]')!;
      expect(width.value).toBe(String(Number(fitted.width.toFixed(2))));
      expect(length.value).toBe(String(Number(fitted.length.toFixed(2))));
      expect(fitted.width).not.toBe(Number(width.value));
      expect(fitted.length).not.toBe(Number(length.value));
      expect(container.textContent).not.toContain(String(fitted.width));
      React.act(() => width.focus()); React.act(() => width.blur());
      React.act(() => length.focus()); React.act(() => length.blur());
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].arbitrarySizeMm).toEqual(fitted);
      clickBinHistory(container, "undo");
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].arbitrarySizeMm).toEqual(spec.arbitrarySizeMm);
    } finally { unmount(); }
  });

  it.each(["standard", "workflow"] as const)("edits arbitrary millimetre sizes and sparse pegs with undo in the %s layout", async layoutMode => {
    const original = parseBinSpec({ gridX: 16, gridY: 3, gridPitch: "quarter", heightUnits: 1, lip: "none", pegBottom: { underside: "flat", lengthMm: 3.5 } });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec: original });
    if (layoutMode === "workflow") localStorage.setItem("pocketry.layout-mode", "workflow");
    const { container, unmount } = renderPage(); await flushHydration();
    const choose = (selector: string, label: string) => {
      const trigger = container.querySelector<HTMLButtonElement>(selector)!;
      React.act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
      React.act(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(o => o.textContent === label)!.click());
    };
    const enter = (label: string, value: string) => {
      const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
      React.act(() => { input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
      React.act(() => input.blur());
    };
    try {
      openSettingsSection(container, "size");
      expect(container.querySelector('[data-testid="select-grid-pitch"]')).toBeNull();
      const current = () => vi.mocked(useBinGeometry).mock.lastCall![0];
      expect(current().arbitrarySizeMm).toBeNull();
      expect(container.querySelector<HTMLInputElement>('[aria-label="Fixture width in millimetres"]')!.value).toBe("167.5");
      enter("Fixture width in millimetres", "171.2"); enter("Fixture length in millimetres", "29.7"); enter("Fixture body thickness in millimetres", "7.3");
      expect(current().arbitrarySizeMm).toEqual({ width: 171.2, length: 29.7 }); expect(current().heightUnits * 7).toBeCloseTo(7.3);
      expect(container.querySelector<HTMLInputElement>('[aria-label="Fixture body thickness in millimetres"]')!.max).toBe("420");
      enter("Fixture body thickness in millimetres", "420");
      expect(current().heightUnits).toBe(MAX_HEIGHT_UNITS);
      clickBinHistory(container, "undo");
      expect(current().heightUnits * 7).toBeCloseTo(7.3);
      expect(container.querySelector('[data-testid="button-edit-footprint"]')).toBeNull();
      openSettingsSection(container, "construction");
      expect(container.textContent).not.toContain("exports pocket-side down");
      await React.act(async () => container.querySelector<HTMLButtonElement>('[aria-label="About underside"]')!.click());
      expect(document.querySelector('[role="tooltip"]')!.textContent).toContain("exports pocket-side down, with pegs up");
      React.act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      choose('[aria-label="Peg density"]', "Corners only"); expect(current().pegBottom!.density).toBe("corners");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(current().pegBottom!.density).toBe(1);
      choose('[aria-label="Peg density"]', "Every 3 holes"); expect(current().pegBottom!.density).toBe(3);
      choose('[aria-label="Peg underside"]', "Sloped roots"); expect(current().pegBottom!.density).toBe(1);
    } finally { unmount(); }
  });

  it("switches a custom bin across full, half and quarter pitches without moving its split pocket", async () => {
    const shape = rectangularShape("tool", "Cutter");
    const cutout = parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: -20, y: -20 },
      split: { boundary: [{ x: 0, y: -10 }, { x: 0, y: 10 }], depths: [{ mode: "mm", value: 6 }, { mode: "mm", value: 20 }] } });
    const original = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, flatBottom: true,
      footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] } });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec: original, shapes: [shape], cutouts: [cutout] });
    const { container, unmount } = renderPage();
    await flushHydration();
    try {
      const trigger = container.querySelector<HTMLButtonElement>('[data-testid="select-grid-pitch"]')!;
      expect(trigger.textContent).toBe("Full · 42 mm");
      for (const [label, count] of [["Half · 21 mm", 12], ["Quarter · 10.5 mm", 48], ["Full · 42 mm", 3]] as const) {
        React.act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
        const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
        expect(options.filter(option => !option.textContent?.startsWith("Arbitrary")).every(option => option.getAttribute("aria-disabled") !== "true")).toBe(true);
        React.act(() => options.find(option => option.textContent === label)!.click());
        const [spec, , layout] = vi.mocked(useBinGeometry).mock.lastCall!;
        expect(occupiedCellCount(spec)).toBe(count);
        expect(footprintOuterRingMm(spec, 32)).toEqual(footprintOuterRingMm(original, 32));
        expect(layout?.cutouts).toEqual([cutout]);
        expect(container.querySelector("#bin-settings-size")?.textContent).toContain("Outer size 83.5 × 83.5 × 45.6 mm");
      }
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(trigger.textContent).toBe("Quarter · 10.5 mm");
      expect(occupiedCellCount(vi.mocked(useBinGeometry).mock.lastCall![0])).toBe(48);
    } finally { unmount(); }
  });

  it("disables only a pitch that would alter a custom footprint", async () => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, gridPitch: "half",
        footprint: { kind: "custom", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] } }) });
    const { container, unmount } = renderPage();
    await flushHydration();
    try {
      const trigger = container.querySelector<HTMLButtonElement>('[data-testid="select-grid-pitch"]')!;
      expect(trigger.textContent).toBe("Half · 21 mm");
      React.act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
      const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
      expect(options.find(option => option.textContent === "Full · 42 mm (would change shape)")?.getAttribute("aria-disabled")).toBe("true");
      expect(options.find(option => option.textContent === "Half · 21 mm")?.getAttribute("aria-disabled")).not.toBe("true");
      expect(options.find(option => option.textContent === "Quarter · 10.5 mm")?.getAttribute("aria-disabled")).not.toBe("true");
    } finally { unmount(); }
  });

  it("switches a 3 by 5 bin to quarter pitch and edits beyond 16 small cells", async () => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT,
      spec: parseBinSpec({ gridX: 6, gridY: 10, gridPitch: "half", heightUnits: 5.5 }),
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    try {
      const trigger = container.querySelector<HTMLButtonElement>('[data-testid="select-grid-pitch"]')!;
      React.act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
      const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((node) => node.textContent === "Quarter · 10.5 mm")!;
      expect(option).toBeDefined();
      expect(option.getAttribute("aria-disabled")).not.toBe("true");
      React.act(() => option.click());
      const size = container.querySelector("#bin-settings-size")!;
      expect(size.textContent).toContain("3 × 5 × 5.5u");
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toMatchObject({ gridX: 12, gridY: 20, gridPitch: "quarter" });
      const input = (label: string) => container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
      expect(input("Width in standard cells").value).toBe("3");
      expect(input("Length in standard cells").value).toBe("5");
      expect(size.textContent).toContain("Outer size 125.5 × 209.5 × 42.1 mm");

      const length = input("Length in standard cells");
      React.act(() => length.focus());
      React.act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(length, "5.25");
        length.dispatchEvent(new Event("input", { bubbles: true }));
      });
      React.act(() => length.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      expect(size.textContent).toContain("3 × 5.25 × 5.5u");
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toMatchObject({ gridX: 12, gridY: 21, gridPitch: "quarter" });
      expect(size.textContent).toContain("Outer size 125.5 × 220.0 × 42.1 mm");
    } finally {
      unmount();
    }
  });

  it.each(["standard", "workflow"])("edits restored tall bins up to the shared height limit in %s layout", async layout => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, spec: parseBinSpec({ ...EMPTY_PROJECT.spec, heightUnits: 50.5 }),
    });
    const { container, unmount } = renderPage({ experimental: false });
    try {
      await flushHydration();
      openSettingsSection(container, "size");
      const input = container.querySelector<HTMLInputElement>('[aria-label="Bin height in units"]')!;
      const slider = container.querySelector<HTMLElement>('[role="slider"][aria-label="Height in 0.5u increments"]')!;
      const height = () => vi.mocked(useBinGeometry).mock.lastCall![0].heightUnits;
      expect(input.value).toBe("50.5");
      expect(input.max).toBe(String(MAX_HEIGHT_UNITS));
      expect(slider.getAttribute("aria-valuenow")).toBe("50.5");
      expect(slider.getAttribute("aria-valuemax")).toBe(String(MAX_HEIGHT_UNITS));
      React.act(() => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
      expect(height()).toBe(51);
      clickBinHistory(container, "undo");
      expect(height()).toBe(50.5);
      clickBinHistory(container, "redo");
      expect(height()).toBe(51);
      React.act(() => input.focus());
      React.act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, String(MAX_HEIGHT_UNITS));
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      React.act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      expect(height()).toBe(MAX_HEIGHT_UNITS);
      expect(container.querySelector("#bin-settings-size")!.textContent).toContain("423.6 mm");
      React.act(() => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
      expect(height()).toBe(MAX_HEIGHT_UNITS);
    } finally {
      unmount();
      window.history.replaceState(null, "", originalUrl);
    }
  });

  it("sets width, length, and height in half-unit increments", async () => {
    const { container, unmount } = renderPage();
    await flushHydration();

    const width = container.querySelector<HTMLElement>(
      '[aria-label="Width in standard Gridfinity cells"]',
    );
    expect(width).not.toBeNull();
    React.act(() => {
      width!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
      width!.dispatchEvent(
        new KeyboardEvent("keyup", { key: "ArrowLeft", bubbles: true }),
      );
    });

    const sizeSection = container.querySelector("#bin-settings-size");
    expect(sizeSection?.textContent).toContain("Outer size 62.5 × 83.5 × 45.6 mm");
    expect(sizeSection?.textContent).toContain("1.5 × 2 × 6u");
    expect(
      container.querySelector('[data-testid="select-grid-pitch"]')?.textContent,
    ).toContain("Half");

    const length = container.querySelector<HTMLElement>(
      '[aria-label="Length in standard Gridfinity cells"]',
    );
    expect(length).not.toBeNull();
    React.act(() => {
      length!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
      length!.dispatchEvent(
        new KeyboardEvent("keyup", { key: "ArrowLeft", bubbles: true }),
      );
    });
    expect(sizeSection?.textContent).toContain("1.5 × 1.5 × 6u");

    const height = container.querySelector<HTMLElement>(
      '[aria-label="Height in 0.5u increments"]',
    );
    expect(height).not.toBeNull();
    React.act(() => {
      height!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
      height!.dispatchEvent(
        new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }),
      );
    });

    expect(container.querySelector<HTMLInputElement>('[aria-label="Bin height in units"]')?.value).toBe("6.5");
    expect(sizeSection?.textContent).toContain("1.5 × 1.5 × 6.5u");
    unmount();
  });

  it("restores a custom L footprint and exposes its cell editor", async () => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT,
      spec: parseBinSpec({
        gridX: 2,
        gridY: 2,
        heightUnits: 6,
        footprint: {
          kind: "custom",
          cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
        },
      }),
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    expect(container.querySelector("#bin-settings-size")?.textContent)
      .toContain("Custom footprint. Add or remove cells in the Layout view");
    const edit = container.querySelector('[data-testid="button-edit-footprint"]') as HTMLButtonElement;
    React.act(() => edit.click());
    expect(container.querySelector('[data-testid="layout-canvas"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="footprint-cell"]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-testid="footprint-halo-cell"]')).toHaveLength(6);
    expect(container.querySelector('[data-testid="button-reset-footprint"]')).not.toBeNull();
    unmount();
  });});

it.each(["controls", "workflow"] as const)("exports a jig SVG and matching optional backup in %s layout with Experimental off", async layout => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, "", `/bin?layout=${layout}`);
  const shape = rectangularShape("jig-tool", "Tool");
  const finger = fingerHoleSchema.parse({ id: "jig-access", center: { x: 0, y: 25 }, diameterMm: 10, depthMm: 5 });
  const cutout = parseCutoutPlacement({ id: "jig-pocket", shapeId: shape.id, depth: { mode: "through" }, position: { x: 0, y: 0 } });
  const doc = { ...EMPTY_PROJECT, spec: parseBinSpec({ ...EMPTY_PROJECT.spec, lip: "none", pegBottom: DEFAULT_PEG_BOTTOM }), shapes: [shape], cutouts: [cutout], fingerHoles: [finger] };
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(doc);
  const { container, unmount } = renderPage({ experimental: false });
  try {
    await flushHydration();
    openSettingsSection(container, "export");
    expect(container.textContent).toContain("Alignment layout");
    expect(container.textContent).not.toContain("Export layout");
    const button = container.querySelector<HTMLButtonElement>('[data-testid="button-layout-svg"]')!;
    expect(button.textContent).toBe("Save alignment SVG");
    expect(button.disabled).toBe(false);
    expect(container.querySelector('[data-testid="button-layout-dxf"]')).not.toBeNull();
    for (const includeProject of [false, true]) {
      vi.mocked(downloadBlob).mockClear();
      React.act(() => button.click());
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Save Wham Bam Systems ULTIM8-compatible alignment SVG?");
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain("does not set a bed position");
      expect(downloadBlob).not.toHaveBeenCalled();
      if (includeProject) React.act(() => document.querySelector<HTMLButtonElement>('[data-testid="checkbox-export-project"]')!.click());
      await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-export"]')!.click());
      expect(generateUltim8JigSVG).toHaveBeenLastCalledWith(doc.spec, [cutout], new Map([[shape.id, shape]]), [finger]);
      expect(downloadBlob).toHaveBeenCalledTimes(includeProject ? 2 : 1);
      const [model, name] = vi.mocked(downloadBlob).mock.calls.at(-1)!;
      expect(model.type).toBe("image/svg+xml");
      expect(name).toMatch(/-ultim8-jig-layout-.*\.svg$/);
      if (includeProject) {
        const [backup, backupName] = vi.mocked(downloadBlob).mock.calls[0];
        expect(backupName).toBe(name.replace(/\.svg$/, ".pocketry.json"));
        const json = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(backup); });
        expect(parseProjectDoc(JSON.parse(json))).toMatchObject({ spec: doc.spec, cutouts: [cutout], fingerHoles: [finger] });
      }
    }
  } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
});

it("offers the jig reference for a peg-only bin and preserves ordinary empty-bin controls", async () => {
  for (const jig of [false, true]) {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec: parseBinSpec({ ...EMPTY_PROJECT.spec, lip: "none", pegBottom: jig ? DEFAULT_PEG_BOTTOM : null }) });
    const { container, unmount } = renderPage({ experimental: true });
    try {
      await flushHydration();
      openSettingsSection(container, "export");
      expect(container.querySelector('[data-testid="button-layout-svg"]') !== null).toBe(jig);
      expect(container.textContent?.includes("Alignment layout")).toBe(jig);
    } finally { unmount(); }
  }
});

it("downloads neither jig SVG nor backup when generation fails", async () => {
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec: parseBinSpec({ ...EMPTY_PROJECT.spec, pegBottom: DEFAULT_PEG_BOTTOM }) });
  vi.mocked(generateUltim8JigSVG).mockRejectedValueOnce(new Error("Jig geometry unavailable"));
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    openSettingsSection(container, "export");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-layout-svg"]')!.click());
    React.act(() => document.querySelector<HTMLButtonElement>('[data-testid="checkbox-export-project"]')!.click());
    await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-export"]')!.click());
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(projectToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Layout export failed", description: "Jig geometry unavailable" }));
  } finally { unmount(); }
});

it.each(["standard", "workflow"])("retains per-sub-bin tab placement while changing style and undoing in %s", async layout => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, "", `/bin?layout=${layout}`);
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(parseProjectDoc({ ...EMPTY_PROJECT,
    spec: { ...EMPTY_PROJECT.spec, fill: "none", compartments: { rows: 2, columns: 3 }, labelTab: { wall: "north", width: "full", scope: "compartments" } } }));
  const { container, unmount } = renderPage({ experimental: false });
  try {
    await flushHydration(); openSettingsSection(container, "construction");
    const placement = () => container.querySelector<HTMLButtonElement>('[aria-label="Label tab placement"]')!;
    const group = container.querySelector<HTMLDivElement>('[data-testid="label-tab-settings"]')!;
    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="label-tab-settings-trigger"]')!;
    expect(group.hidden).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-controls")).toBe(group.id);
    React.act(() => trigger.click());
    expect(group.hidden).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(group.contains(placement())).toBe(true);
    expect(group.querySelector('[aria-label="Label tab wall"]')).not.toBeNull();
    expect(placement().textContent).toBe("Each sub-bin");
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-choose-label-edge"]')!.disabled).toBe(true);
    React.act(() => placement().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    const outer = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(el => el.textContent === "Outer wall")!;
    React.act(() => outer.click());
    expect(vi.mocked(useBinGeometry).mock.lastCall![0].labelTab!.scope).toBe("outer");
    clickBinHistory(container, "undo");
    expect(placement().textContent).toBe("Each sub-bin");
    React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Label tab style"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    const centered = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(el => el.textContent === "Center · 42 mm")!;
    React.act(() => centered.click());
    expect(vi.mocked(useBinGeometry).mock.lastCall![0].labelTab).toMatchObject({ width: "center", scope: "compartments" });
  } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
});


it.each(["standard", "workflow"])("defaults tabs opposite scoops and retains manual placement in %s", async layout => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, "", `/bin?layout=${layout}`);
  const { container, unmount } = renderPage();
  try {
    await flushHydration(); openSettingsSection(container, "construction");
    const choose = (field: string, label: string) => {
      React.act(() => container.querySelector<HTMLButtonElement>(`[aria-label="${field}"]`)!.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
      const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
      if (field === "Label tab style") expect(options.some(option => option.textContent === "None")).toBe(false);
      React.act(() => options.find(option => option.textContent === label)!.click());
    };
    const current = () => vi.mocked(useBinGeometry).mock.lastCall![0];
    const slantToggle = () => React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Slanted walls (prototype)"]')!.click());
    const angle = (value: string) => {
      const input = container.querySelector<HTMLInputElement>('[aria-label="Wall angle in degrees"]')!;
      React.act(() => {
        input.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      React.act(() => input.blur());
    };
    const labelToggle = () => React.act(() => container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Label tab"]')!.click());
    const labelSettings = () => container.querySelector<HTMLDivElement>('[data-testid="label-tab-settings"]');
    const labelTrigger = () => container.querySelector<HTMLButtonElement>('[data-testid="label-tab-settings-trigger"]');
    expect(labelSettings()).toBeNull();
    expect(labelTrigger()).toBeNull();
    expect(container.querySelector('[aria-label="Label tab style"]')).toBeNull();
    expect(container.querySelector('[aria-label="Label tab placement"]')).toBeNull();
    labelToggle();
    expect(labelSettings()!.hidden).toBe(true);
    const beforeDisclosure = current();
    React.act(() => labelTrigger()!.click());
    expect(labelSettings()!.hidden).toBe(false);
    expect(current()).toBe(beforeDisclosure);
    choose("Label tab style", "Full width");
    expect(current().labelTab).toMatchObject({ autoWall: true, wall: "north", recessMm: 0.4 });
    const recess = () => container.querySelector<HTMLInputElement>('[aria-label="Label tab recess in millimetres"]')!;
    expect(recess().value).toBe("0.4");
    const enterRecess = (value: string) => {
      React.act(() => {
        recess().focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(recess(), value);
        recess().dispatchEvent(new Event("input", { bubbles: true }));
      });
      React.act(() => recess().blur());
    };
    enterRecess("0.8");
    expect(current().labelTab!.recessMm).toBe(0.8);
    clickBinHistory(container, "undo");
    expect(recess().value).toBe("0.4");
    clickBinHistory(container, "redo");
    expect(recess().value).toBe("0.8");
    enterRecess("0");
    expect(current().labelTab!.recessMm).toBe(0);
    slantToggle();
    expect(current().labelTab).toMatchObject({ autoWall: true, wall: "south" });
    expect(container.querySelector('[aria-label="Label tab wall"]')!.textContent).toBe("Auto · Front");
    React.act(() => container.querySelector<HTMLElement>('[data-testid="wall-slant-settings-trigger"]')!.click());
    choose("Wall slant axis", "Width (X)");
    expect(current().labelTab!.wall).toBe("west");
    angle("-20");
    expect(current().labelTab!.wall).toBe("east");
    choose("Label tab wall", "Back");
    angle("20");
    expect(current().labelTab).toMatchObject({ autoWall: false, wall: "north" });
    clickBinHistory(container, "undo");
    expect(current().wallSlant!.angleDeg).toBe(-20);
    expect(current().labelTab!.wall).toBe("north");
    choose("Label tab wall", "Auto · Right");
    expect(current().labelTab).toMatchObject({ autoWall: true, wall: "east" });
    slantToggle();
    expect(current().labelTab!.wall).toBe("north");
    clickBinHistory(container, "undo");
    expect(current().labelTab).toMatchObject({ autoWall: true, wall: "east" });
    React.act(() => labelTrigger()!.click());
    expect(labelSettings()!.hidden).toBe(true);
    labelToggle();
    expect(current().labelTab).toBeNull();
    expect(labelSettings()).toBeNull();
    expect(labelTrigger()).toBeNull();
    expect(container.querySelector('[aria-label="Label tab placement"]')).toBeNull();
    expect(container.querySelector('[aria-label="Label tab wall"]')).toBeNull();
    clickBinHistory(container, "undo");
    expect(current().labelTab).toMatchObject({ autoWall: true, wall: "east" });
    expect(labelSettings()!.hidden).toBe(true);
    clickBinHistory(container, "redo");
    expect(current().labelTab).toBeNull();
    // Adding a tab after the slant is configured uses the same acute-side default.
    labelToggle();
    React.act(() => labelTrigger()!.click());
    choose("Label tab style", "Center · 42 mm");
    expect(current().labelTab).toMatchObject({ autoWall: true, wall: "east", width: "center" });
    const edgeButton = () => container.querySelector<HTMLButtonElement>('[data-testid="button-choose-label-edge"]')!;
    React.act(() => edgeButton().click());
    expect(edgeButton().textContent).toBe("Cancel edge selection");
    labelToggle();
    labelToggle();
    React.act(() => labelTrigger()!.click());
    expect(edgeButton().textContent).toBe("Choose any edge");
  } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
});
