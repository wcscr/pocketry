import {
  binGeometryMock,
  EMPTY_PROJECT,
  rectangularShape,
  flushHydration,
  BinDesignerPage,
  render,
  renderPage,
  openSettingsSection,
  toolButton,
  clickBinHistory,
  selectPocket,
  pocketFieldCases,
} from "./bin-designer.test-support";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { PanelProvider, usePanelState } from "@/components/layout/panel-context";
import { ShapeLibraryProvider } from "@/state/shape-library";
import { parseProjectDoc } from "@shared/gridfinity/project";
import { DEFAULT_BIN_MATERIALS } from "@shared/gridfinity/materials";
import { fingerHoleSchema, resolvePlacedPocketDepth, parseCutoutPlacement } from "@shared/gridfinity/cutout";
import { resolvePocketSplit } from "@shared/gridfinity/pocket-split";
import { parseBinSpec } from "@shared/gridfinity/types";
import { downloadBlob } from "@/lib/download";
import { useBinGeometry } from "@/lib/gridfinity/use-bin-geometry";
import * as ProjectPersistence from "@/lib/project/persist";

describe("BinDesignerPage", () => {

  it.each([false, true])("keeps saved deferred depths through backup, reload, export recovery, and undo (mobile=%s)", async mobile => {
    const shapes = [rectangularShape("first", "Tool 1"), rectangularShape("second", "Tool 2")];
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec: { ...EMPTY_PROJECT.spec, fill: "solid" }, shapes,
      cutouts: shapes.map((shape, index) => parseCutoutPlacement({ id: shape.id, shapeId: shape.id, position: { x: index * 15, y: 0 }, depthPending: true })),
    });
    const first = renderPage({ mobile });
    const layout = () => vi.mocked(useBinGeometry).mock.lastCall![2]!;
    const button = (host: ParentNode, label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label)!;
    await flushHydration();
    expect(layout().cutouts.every(c => c.depthPending)).toBe(true);
    React.act(() => button(first.container, "Set depth").click());
    const prompt = first.container.querySelector('[data-testid="pending-pocket-depth"]')!;
    expect(prompt.textContent).toContain("Tool 1");
    if (!mobile) expect(first.container.querySelector('[data-testid="desktop-workspace-controls"]')?.getAttribute("aria-hidden")).toBeNull();
    expect(first.container.querySelector('[role="dialog"]')).toBeNull();
    React.act(() => button(prompt, "Set later").click());
    expect(prompt.textContent).toContain("Depth needed");
    expect(layout().cutouts.every(c => c.depthPending)).toBe(true);
    openSettingsSection(first.container, "project");
    React.act(() => first.container.querySelector<HTMLButtonElement>('[data-testid="button-export-project"]')!.click());
    const [blob] = vi.mocked(downloadBlob).mock.lastCall!;
    const json = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
    const saved = parseProjectDoc(JSON.parse(json))!;
    expect(saved.cutouts.every(c => c.depthPending)).toBe(true);
    expect(saved.history!.stack[saved.history!.index].doc.cutouts).toEqual(saved.cutouts);
    first.unmount(); sessionStorage.clear();
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(saved);
    const reopened = renderPage({ mobile });
    try {
      await flushHydration();
      expect(layout().cutouts.every(c => c.depthPending)).toBe(true);
      openSettingsSection(reopened.container, "export");
      expect(reopened.container.querySelector<HTMLButtonElement>('[data-testid="button-export-3mf"]')!.disabled).toBe(true);
      React.act(() => reopened.container.querySelector<HTMLButtonElement>('[data-export-issue="pocket-depth-needed"]')!.click());
      if (!mobile) expect(reopened.container.querySelector('[data-testid="desktop-workspace-controls"]')?.getAttribute("aria-hidden")).toBeNull();
      const question = reopened.container.querySelector('[data-testid="pending-pocket-depth"]')!;
      expect(question.textContent).toContain("How deep should this pocket be?");
      const input = question.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!;
      React.act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "8"); input.dispatchEvent(new Event("input", { bubbles: true })); });
      React.act(() => question.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
      React.act(() => button(question, "Done").click());
      expect(layout().cutouts.every(c => !c.depthPending && c.depth.mode === "mm" && c.depth.value === 8)).toBe(true);
      openSettingsSection(reopened.container, "export");
      expect(reopened.container.querySelector<HTMLButtonElement>('[data-testid="button-export-3mf"]')!.disabled).toBe(false);
      // The entire batch is one edit and undo restores the unresolved state.
      React.act(() => reopened.container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(layout().cutouts.every(c => c.depthPending)).toBe(true);
    } finally { reopened.unmount(); }
  });

  it.each([
    { layout: "standard", mobile: false }, { layout: "workflow", mobile: false },
    { layout: "standard", mobile: true }, { layout: "workflow", mobile: true },
  ])("preserves pending-depth drafts through dismissal and direct bin-height recovery: %o", async ({ layout, mobile }) => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const shapes = [rectangularShape("first", "Tool 1"), rectangularShape("second", "Tool 2")];
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      spec: { ...EMPTY_PROJECT.spec, heightUnits: 6, fill: "solid" }, shapes,
      cutouts: shapes.map((shape, index) => parseCutoutPlacement({ id: shape.id, shapeId: shape.id, position: { x: index * 15, y: 0 }, depthPending: true })),
    });
    const { container, unmount } = renderPage({ mobile });
    const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label)!;
    const input = () => container.querySelector<HTMLInputElement>('[aria-label="Pocket depth (mm)"]')!;
    const enter = (field: HTMLInputElement, value: string) => React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const current = () => vi.mocked(useBinGeometry).mock.lastCall![2]!;
    try {
      await flushHydration();
      React.act(() => button("Set depth").click());
      enter(input(), "50");
      expect(button("Done").disabled).toBe(true);
      React.act(() => button("Through — no bottom").click());
      React.act(() => button("Set later").click());
      React.act(() => button("Set depth").click());
      expect(input().value).toBe("50");
      expect(button("Through — no bottom").getAttribute("aria-pressed")).toBe("true");
      React.act(() => button("Fixed depth").click());
      React.act(() => button("Edit bin height").click());
      await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
      const height = container.querySelector<HTMLInputElement>('#bin-height-units')!;
      expect(height.closest('[hidden], [inert]')).toBeNull();
      expect(document.activeElement).toBe(height);
      expect(current().cutouts.every(c => c.depthPending)).toBe(true);
      expect(container.querySelector('[data-testid="pending-pocket-depth"]')?.textContent).toContain("Tool 1");
      enter(height, "9");
      React.act(() => height.blur());
      if (mobile) React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-back-to-canvas"]')!.click());
      React.act(() => button("Set depth").click());
      expect(input().value).toBe("50");
      expect(button("Fixed depth").getAttribute("aria-pressed")).toBe("true");
      expect(button("Done").disabled).toBe(false);
      expect(current().cutouts.every(c => c.depthPending)).toBe(true);
      React.act(() => button("Done").click());
      expect(current().cutouts[0]).toMatchObject({ depth: { mode: "mm", value: 50 } });
      expect(current().cutouts[0].depthPending).toBeUndefined();
      expect(current().cutouts[1].depthPending).toBe(true);
      openSettingsSection(container, "export");
      expect(container.querySelector<HTMLButtonElement>('[data-testid="button-export-3mf"]')!.disabled).toBe(true);
    } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
  });

  it("asks about saved unresolved pockets one at a time", async () => {
    const shapes = [rectangularShape("first", "Tool 1"), rectangularShape("second", "Tool 2")];
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes,
      cutouts: shapes.map((shape, index) => parseCutoutPlacement({ id: shape.id, shapeId: shape.id, position: { x: index * 15, y: 0 }, depthPending: true })),
    });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      React.act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Set depth")!.click());
      const prompt = () => container.querySelector('[data-testid="pending-pocket-depth"]')!;
      const button = (label: string) => [...prompt().querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label)!;
      React.act(() => button("To bin floor").click());
      React.act(() => button("Done").click());
      expect(prompt().textContent).toContain("Tool 2");
      expect(prompt().querySelector<HTMLInputElement>('input[inputmode="decimal"]')!.value).toBe("");
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts.filter(c => c.depthPending)).toHaveLength(1);
      React.act(() => button("Through — no bottom").click());
      React.act(() => button("Done").click());
      expect(prompt()).toBeNull();
      expect(container.textContent).toContain("Trace another photo");
    } finally { unmount(); }
  });

  it("continues to the next unresolved pocket after a depth also resolves linked copies", async () => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      spec: { ...EMPTY_PROJECT.spec, fill: "solid" }, shapes: [rectangularShape("tool", "Tool")],
      cutouts: ["Original", "Linked copy", "Independent"].map((name, index) => parseCutoutPlacement({
        id: name, name, shapeId: "tool", position: { x: index * 15, y: 0 }, depthPending: true,
        designLink: index < 2 ? { id: "linked-tools", tilt: false } : undefined,
      })),
    });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      const button = (host: ParentNode, label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === label)!;
      React.act(() => button(container, "Set depth").click());
      const prompt = () => container.querySelector('[data-testid="pending-pocket-depth"]')!;
      expect(prompt().textContent).toContain("Original");
      React.act(() => button(prompt(), "To bin floor").click());
      React.act(() => button(prompt(), "Done").click());
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts.filter(c => c.depthPending).map(c => c.id)).toEqual(["Independent"]);
      expect(prompt()?.textContent).toContain("Independent");
    } finally { unmount(); }
  });

  it.each([
    { fixed: false, flatBottom: false }, { fixed: true, flatBottom: false },
    { fixed: false, flatBottom: true }, { fixed: true, flatBottom: true },
  ])("defaults unmeasured tools to the bin floor and preserves chosen depths, history, and export: %o", async ({ fixed, flatBottom }) => {
    sessionStorage.setItem("pocketry:queued-tools", JSON.stringify([
      { ...rectangularShape("shallow", "Shallow tool"), pendingDepth: { mode: "mm", value: 7.5 } },
      { ...rectangularShape("through", "Through jig"), pendingDepth: { mode: "through" } },
      { ...rectangularShape("floor", "To Floor tool"), pendingDepth: { mode: "to-floor" } },
      { ...rectangularShape("unset", "Unmeasured tool"), pendingDepth: { mode: "unset" } },
      rectangularShape("missing", "Tool without a depth"),
      { ...rectangularShape("custom-floor", "Custom floor tool"), pendingDepth: { mode: "remaining", floorThicknessMm: 10 } },
    ]));
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, keepBinSize: fixed,
      spec: parseBinSpec({ ...EMPTY_PROJECT.spec, fill: "solid", flatBottom }) });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      const layout = () => vi.mocked(useBinGeometry).mock.lastCall![2]!;
      const depths = () => Object.fromEntries(layout().cutouts.map(pocket => [pocket.shapeId, pocket.depth]));
      const expected = { shallow: { mode: "mm", value: 7.5 }, through: { mode: "through" },
        floor: { mode: "remaining", floorThicknessMm: flatBottom ? 2 : 7 },
        unset: { mode: "remaining", floorThicknessMm: flatBottom ? 2 : 7 },
        missing: { mode: "remaining", floorThicknessMm: flatBottom ? 2 : 7 },
        "custom-floor": { mode: "remaining", floorThicknessMm: 10 } };
      expect(depths()).toEqual(expected);
      expect(layout().cutouts.every(cutout => !cutout.depthPending)).toBe(true);
      expect(container.querySelector('[data-testid="pending-pocket-depth"]')).toBeNull();
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].heightUnits).toBe(6);
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(layout().cutouts).toHaveLength(0);
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-redo"]')!.click());
      expect(depths()).toEqual(expected);
      openSettingsSection(container, "project");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-export-project"]')!.click());
      const [blob] = vi.mocked(downloadBlob).mock.lastCall!;
      const json = await new Promise<string>(resolve => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob);
      });
      const saved = parseProjectDoc(JSON.parse(json))!;
      expect(saved).not.toBeNull();
      expect(Object.fromEntries(saved.cutouts.map(pocket => [pocket.shapeId, pocket.depth]))).toEqual(expected);
      expect(saved.history!.stack[saved.history!.index].doc.cutouts).toEqual(saved.cutouts);
      expect(saved.shapes.every(shape => !("pendingDepth" in shape))).toBe(true);
    } finally { unmount(); }
  });
  describe.each(["standard", "workflow"])("pocket field ownership (%s)", layout => {
    it.each(["", "-1"])("cancels an invalid draft (%j), including its earlier valid split-section preview", async invalid => {
      const originalUrl = window.location.href;
      window.history.replaceState(null, "", `/bin?layout=${layout}`);
      const shape = rectangularShape("split-field-source", "Split driver");
      const first = parseCutoutPlacement({ id: "first", shapeId: shape.id, position: { x: -15, y: 0 },
        split: { boundary: [{ x: 0, y: -10 }, { x: 0, y: 10 }],
          depths: [{ mode: "remaining", floorThicknessMm: 6 }, { mode: "remaining", floorThicknessMm: 4 }] } });
      const second = { ...first, id: "second", position: { x: 15, y: 0 } };
      vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [first, second] });
      const { container, unmount } = renderPage();
      try {
        await flushHydration();
        openSettingsSection(container, "tool-cutouts");
        selectPocket(container, first.id);
        const committed = () => vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts;
        const before = committed();
        const field = () => container.querySelector<HTMLInputElement>('[aria-label="Remaining floor thickness in millimetres"]')!;
        const input = field();
        const type = (value: string) => React.act(() => {
          input.focus();
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        type("8");
        type(invalid);
        React.act(() => [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "Section B")!.click());
        React.act(() => input.blur());
        expect(field().value).toBe("4");
        expect(committed()).toEqual(before);
        expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
        expect(committed()[1]).toEqual(before[1]);
        selectPocket(container, second.id);
        expect(field().value).toBe("6");
        const after = committed();
        React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
        expect(committed()).toEqual(before);
        clickBinHistory(container, "redo");
        expect(committed()).toEqual(after);
      } finally {
        unmount();
        window.history.replaceState(null, "", originalUrl);
      }
    });

    it("resets spacing choices and displays each pocket's controlled switches", async () => {
      const originalUrl = window.location.href;
      window.history.replaceState(null, "", `/bin?layout=${layout}`);
      const shape = rectangularShape("spacing-source", "Driver");
      const first = parseCutoutPlacement({ id: "first", shapeId: shape.id, position: { x: -15, y: 0 } });
      const second = { ...first, id: "second", position: { x: 15, y: 0 }, mirrored: true, aspectRatioLocked: false };
      vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [first, second] });
      const { container, unmount } = renderPage();
      try {
        await flushHydration();
        openSettingsSection(container, "tool-cutouts");
        selectPocket(container, first.id);
        const reference = container.querySelector<HTMLSelectElement>('[aria-label="Reference pocket"]')!;
        const side = container.querySelector<HTMLSelectElement>('[aria-label="Side of reference pocket"]')!;
        React.act(() => {
          reference.value = second.id; reference.dispatchEvent(new Event("change", { bubbles: true }));
          side.value = "left"; side.dispatchEvent(new Event("change", { bubbles: true }));
        });
        selectPocket(container, second.id);
        expect(container.querySelector<HTMLSelectElement>('[aria-label="Reference pocket"]')!.value).toBe("");
        expect(container.querySelector<HTMLSelectElement>('[aria-label="Side of reference pocket"]')!.value).toBe("right");
        expect([...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Apply gap")!.disabled).toBe(true);
        expect(container.querySelector('[aria-label="Lock pocket aspect ratio"]')?.getAttribute("aria-pressed")).toBe("false");
        const mirror = container.querySelector('#pocket-properties [role="switch"][aria-label="Mirror"]')!;
        expect(mirror.getAttribute("aria-checked")).toBe("true");
      } finally {
        unmount();
        window.history.replaceState(null, "", originalUrl);
      }
    });

    it.each(pocketFieldCases)("keeps %s and its undo entry with the edited pocket", async (label, value) => {
      const originalUrl = window.location.href;
      window.history.replaceState(null, "", `/bin?layout=${layout}`);
      const shape = rectangularShape("field-source", "Driver");
      const first = parseCutoutPlacement({ id: "first", shapeId: shape.id, position: { x: -15, y: 0 },
        depth: label.startsWith("Remaining") ? { mode: "remaining", floorThicknessMm: 6 } : { mode: "mm", value: 12 } });
      const second = { ...first, id: "second", position: { x: 15, y: 0 }, rotationDeg: 45 };
      vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [first, second] });
      const { container, unmount } = renderPage();
      try {
        await flushHydration();
        openSettingsSection(container, "tool-cutouts");
        selectPocket(container, first.id);
        const committed = () => vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts;
        const live = () => vi.mocked(useBinGeometry).mock.lastCall![5]!.layout.cutouts;
        const before = committed();
        const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
        React.act(() => {
          input.closest("details")!.open = true;
          input.focus();
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        const edited = live()[0];
        expect(edited).not.toEqual(before[0]);
        // Selection on pointer-down precedes native blur, including warning-driven selection.
        selectPocket(container, second.id);
        React.act(() => input.blur());
        expect(live()[1]).toEqual(before[1]);
        expect(committed()).toEqual([edited, before[1]]);
        expect(parseProjectDoc({ ...EMPTY_PROJECT, shapes: [shape], cutouts: committed() })?.cutouts).toEqual(committed());
        selectPocket(container, first.id);
        expect(container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!.value).toBe(value);
        React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
        expect(committed()).toEqual(before);
        clickBinHistory(container, "redo");
        expect(committed()).toEqual([edited, before[1]]);
      } finally {
        unmount();
        window.history.replaceState(null, "", originalUrl);
      }
    });});

  it.each(["standard", "workflow"])("keeps a copied pocket's rotation draft out of the next pocket's properties (%s)", async layout => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const shape = rectangularShape("copy-rotation-source", "Rotation tool");
    const original = parseCutoutPlacement({ id: "original", shapeId: shape.id, position: { x: 0, y: 0 } });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [original] });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "size");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-fit-bin"]')!.click());
      openSettingsSection(container, "tool-cutouts");
      selectPocket(container, original.id);
      if (layout === "workflow") {
        React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Actions for Rotation tool"]')!
          .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
        React.act(() => document.querySelector<HTMLElement>('[role="menuitem"][aria-label="Duplicate Rotation tool"]')!.click());
        await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
      } else React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-duplicate-original"]')!.click());
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
      const latest = () => vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts;
      const copy = latest().find(c => c.id !== original.id)!;
      const rotation = container.querySelector<HTMLInputElement>('[aria-label="Pocket rotation in degrees"]')!;
      React.act(() => {
        rotation.closest("details")!.open = true;
        rotation.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(rotation, "180");
        rotation.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(latest().find(c => c.id === copy.id)!.rotationDeg).toBe(0);
      expect(vi.mocked(useBinGeometry).mock.lastCall![5]!.layout.cutouts.find(c => c.id === copy.id)!.rotationDeg).toBe(180);
      // Canvas selection happens on pointer-down, before the browser blurs
      // the focused field. Simulate that order instead of blurring first.
      selectPocket(container, original.id);
      React.act(() => rotation.blur());
      expect(latest().find(c => c.id === original.id)!.rotationDeg).toBe(0);
      expect(latest().find(c => c.id === copy.id)!.rotationDeg).toBe(180);
      expect(container.querySelector<HTMLInputElement>('[aria-label="Pocket rotation in degrees"]')!.value).toBe("0");
      expect(container.querySelector<HTMLDetailsElement>('[data-testid="pocket-position-settings"]')!.open).toBe(true);
      const beforeMove = latest();
      React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" })));
      expect(latest().find(c => c.id === original.id)).toMatchObject({
        rotationDeg: 0, position: { x: beforeMove[0].position.x + 1, y: beforeMove[0].position.y },
      });
      expect(latest().find(c => c.id === copy.id)).toEqual(beforeMove.find(c => c.id === copy.id));
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(latest()).toEqual(beforeMove);
      clickBinHistory(container, "redo");
      expect(latest().map(c => c.rotationDeg)).toEqual([0, 180]);
    } finally {
      unmount();
      window.history.replaceState(null, "", originalUrl);
    }
  });

  it.each([false,true])("rotates and resets ordinary pockets in the existing properties with experimental=%s", async experimental => {
    const shape=rectangularShape("rotation-source","Rotation tool");
    const original=parseCutoutPlacement({id:"rotated",shapeId:shape.id,position:{x:3,y:-2}, rotationDeg:20,
      depth:{mode:"mm",value:18},clearanceMm:0.4,cornerRoundMm:1,
      split:{boundary:[{x:0,y:-10},{x:0,y:10}],depths:[{mode:"mm",value:12},{mode:"mm",value:18}]}});
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({...EMPTY_PROJECT,shapes:[shape],cutouts:[original]});
    const {container,unmount}=renderPage({experimental});
    try {
      await flushHydration(); selectPocket(container,original.id);
      const latest=()=>vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0];
      const edit=(label:string,value:string)=> {
        const input=container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
        React.act(()=>{ input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);
          input.dispatchEvent(new Event("input",{bubbles:true})); });
        React.act(()=>input.blur());
      };
      expect(container.querySelector('[aria-label="Use profile as bottom"]')).toBeNull();
      expect(container.querySelector('[aria-label="Pocket depth mode"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="pocket-edge-settings"]')).not.toBeNull();
      edit("Pocket X rotation in degrees","135");
      const clearanceDialog = document.querySelector('[data-testid="pocket-clearance-dialog"]');
      expect(clearanceDialog).not.toBeNull();
      await React.act(async () => {
        [...clearanceDialog!.querySelectorAll<HTMLButtonElement>("button")]
          .find(button => button.textContent === "Keep current settings")!.click();
        await new Promise(resolve => setTimeout(resolve, 5));
      });
      expect(document.querySelector('[data-testid="pocket-clearance-dialog"]')).toBeNull();
      edit("Pocket Y rotation in degrees","-24");
      edit("Pocket elevation in millimetres","80");
      expect(latest().tilt).toEqual({xDeg:135,yDeg:-24});
      expect(latest().elevationMm).toBe(80);
      expect(latest().depth).toEqual(original.depth); expect(latest().split).toEqual(original.split);
      expect(latest().clearanceMm).toBe(0.4);
      const reset=[...container.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Reset to X–Y plane')!;
      React.act(()=>reset.click());
      expect(latest().tilt).toEqual({xDeg:0,yDeg:0});
      expect(latest()).toMatchObject({elevationMm:80,rotationDeg:20,position:original.position,depth:original.depth,split:original.split});
      React.act(()=>container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(latest().tilt).toEqual({xDeg:135,yDeg:-24});
      clickBinHistory(container, "redo");
      expect(latest().tilt).toEqual({xDeg:0,yDeg:0});
      expect(parseProjectDoc({...EMPTY_PROJECT,shapes:[shape],cutouts:[latest()]})?.cutouts[0]).toEqual(latest());
    } finally {unmount();}
  });

  it.each(["empty", "pockets", "split"] as const)("adds a curved, rounded slot using the %s layout's highest floor", async (layout) => {
    const shape = rectangularShape("shape", "Tool");
    const pocket = parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 },
      depth: { mode: "mm", value: 18 },
      ...(layout === "split" ? { split: {
        boundary: [{ x: 0, y: -10 }, { x: 0, y: 10 }],
        depths: [{ mode: "mm", value: 8 }, { mode: "mm", value: 24 }],
      } } : {}),
    });
    const existing = fingerHoleSchema.parse({ id: "existing", kind: "straight", center: { x: 0, y: 0 }, depthMm: 3 });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape],
      cutouts: layout === "empty" ? [] : [pocket], fingerHoles: [existing] });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "finger-holes");
      const add = container.querySelector<HTMLButtonElement>('[data-testid="button-add-finger-hole"]')!;
      expect(add.textContent?.trim()).toBe("Add finger access");
      React.act(() => add.click());
      const expectedDepth = layout === "empty" ? 12 : layout === "split" ? 7 : 17;
      const added = vi.mocked(useBinGeometry).mock.lastCall![2]!.fingerHoles[1];
      expect(added).toMatchObject({ kind: "oblong-deep-scoop", slotEnds: "rounded", lengthMm: 36, depthMm: expectedDepth });
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.fingerHoles[0]).toEqual(existing);
      expect(container.querySelector<HTMLInputElement>('[aria-label="Depth in millimetres"]')!.value).toBe(String(expectedDepth));
      const controls = container.querySelector('[data-testid="finger-access-shape-controls"]')!;
      expect(Array.from(controls.querySelectorAll('[aria-labelledby="finger-access-shape-label"] [role="radio"]'), el => el.textContent)).toEqual(["Slot", "Round"]);
      for (const id of ["finger-shape-slot", "finger-bottom-curved", "finger-ends-rounded"]) {
        expect(controls.querySelector(`[data-testid="${id}"]`)?.getAttribute("aria-checked")).toBe("true");
      }
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.fingerHoles).toEqual([existing]);
      clickBinHistory(container, "redo");
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.fingerHoles).toEqual([existing, added]);
    } finally { unmount(); }
  });

  it("keeps a split attached through a neighbouring contour edit and undo/redo", async () => {
    const shape = rectangularShape("tool", "Cutter");
    const cutout = parseCutoutPlacement({ id: "split-test", shapeId: shape.id, position: { x: 0, y: 0 },
      split: { boundary: [{ x: 0, y: -10 }, { x: 0, y: 10 }], depths: [{ mode: "mm", value: 6 }, { mode: "mm", value: 20 }] } });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [cutout] });
    const { container, unmount } = renderPage();
    await flushHydration();
    try {
      selectPocket(container, cutout.id);
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-edit-contour"]')!.click());
      const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
      Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
      Object.defineProperties(svg, {
        createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) },
        setPointerCapture: { value: () => {} },
      });
      const guide = () => container.querySelector('[data-testid="pocket-split-split-test"] > path:last-child')!.getAttribute('d');
      const originalGuide = guide();
      const vertex = svg.querySelectorAll('[data-testid="contour-vertex-handle"]')[2];
      const pointer = (target: Element, type: string, y: number) => React.act(() => {
        const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: 56.75, clientY: y });
        Object.defineProperty(event, 'pointerId', { value: 1 });
        target.dispatchEvent(event);
      });
      // Move the top-right vertex, away from either split endpoint at x=0.
      pointer(vertex, 'pointerdown', 31.75);
      pointer(svg, 'pointermove', 27.75);
      expect(guide()).toBe('M41.75,51.75 L41.75,29.75');
      pointer(svg, 'pointerup', 27.75);
      expect(guide()).toBe('M41.75,51.75 L41.75,29.75');
      expect(container.querySelector('[data-testid="selected-pocket-section"]')).not.toBeNull();
      const latest = vi.mocked(useBinGeometry).mock.lastCall![2]!;
      expect(latest.cutouts[0].split).toEqual(cutout.split);
      expect(latest.cutouts[0].shapeId).not.toBe(shape.id);
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(guide()).toBe(originalGuide);
      clickBinHistory(container, "redo");
      expect(guide()).toBe('M41.75,51.75 L41.75,29.75');
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0].split).toEqual(cutout.split);
      React.act(() => [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '3D')!.click());
      const paths = JSON.parse(container.querySelector('[data-testid="bin-viewport-stub"]')!.getAttribute('data-measurement-splits')!);
      expect(paths).toEqual([[{ x: 0, y: -10 }, { x: 0, y: 12 }]]);
    } finally { unmount(); }
  });

  it("measures from a transformed split to the perimeter without changing the pocket", async () => {
    const shape = rectangularShape("tool", "Cutter");
    const cutout = parseCutoutPlacement({ id: "split-test", shapeId: shape.id, position: { x: 3, y: -2 },
      rotationDeg: 90, mirrored: true, scaleX: 1.5, scaleY: 0.8,
      split: { boundary: [{ x: 0, y: -10 }, { x: 0, y: 10 }], depths: [{ mode: "mm", value: 6 }, { mode: "mm", value: 20 }] } });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [cutout] });
    const { container, unmount } = renderPage();
    await flushHydration();
    // The 3D ruler receives the same placed split path as Layout.
    const paths = JSON.parse(container.querySelector('[data-testid="bin-viewport-stub"]')!.getAttribute('data-measurement-splits')!);
    expect(paths).toHaveLength(1);
    expect(paths[0][0].x).toBeCloseTo(11);
    expect(paths[0][0].y).toBeCloseTo(-2);
    expect(paths[0][1].x).toBeCloseTo(-5);
    expect(paths[0][1].y).toBeCloseTo(-2);
    React.act(() => [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Layout')!.click());
    const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
    Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
    Object.defineProperty(svg, 'createSVGPoint', { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) });
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-layout-ruler"]')!.click());
    for (const y of [43.95, 66.05]) React.act(() => svg.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 44.75, clientY: y }),
    ));
    expect(container.querySelector('[data-testid="layout-measurement-label"]')?.textContent).toBe('22.50 mm');
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
    unmount();
  });

  it.each(["clicks", "drag"])("creates and edits a split with %s, and removes/undoes it without changing the outline", async gesture => {
    const shape = rectangularShape("tool", "Cutter");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape],
      cutouts: [parseCutoutPlacement({ id: "split-test", shapeId: shape.id, position: { x: 0, y: 0 }, depth: { mode: "mm", value: 20 } })] });
    const { container, unmount } = renderPage();
    await flushHydration();
    selectPocket(container, "split-test");
    const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === label)!;
    const splitSettings = container.querySelector<HTMLDetailsElement>('[data-testid="pocket-split-settings"]')!;
    expect(splitSettings.closest('[aria-label="Pocket depth"]')).toBeNull();
    expect(splitSettings.open).toBe(false);
    React.act(() => splitSettings.querySelector('summary')!.click());
    React.act(() => button("Split pocket").click());
    const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
    Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
    Object.defineProperties(svg, {
      createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) },
      setPointerCapture: { value: () => {} },
    });
    const path = svg.querySelector('[data-cutout-id="split-test"]')!;
    const outline = path.getAttribute('d');
    const pointer = (type: string, x: number, y: number) => React.act(() => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      path.dispatchEvent(event);
    });
    pointer('pointerdown', 41.75, 31.75);
    if (gesture === 'clicks') {
      pointer('pointerup', 41.75, 31.75);
      pointer('pointerdown', 41.75, 51.75);
    } else pointer('pointermove', 41.75, 51.75);
    pointer('pointerup', 41.75, 51.75);
    expect(container.querySelector('[data-testid="pocket-split-split-test"]')).not.toBeNull();
    expect(path.getAttribute('d')).toBe(outline);
    const depth = () => container.querySelector<HTMLInputElement>('[aria-label="Pocket cut depth in millimetres"]')!;
    expect(depth().value).toBe('20');
    const sectionButtons = container.querySelector('[role="group"][aria-label="Section to edit"]')!;
    expect(sectionButtons.closest('details')?.getAttribute('data-testid')).toBe('pocket-depth-summary');
    expect(splitSettings.contains(sectionButtons)).toBe(false);
    React.act(() => button("Section B").click());
    expect(button("Section B").getAttribute('aria-pressed')).toBe('true');
    expect(splitSettings.open).toBe(true);
    React.act(() => {
      depth().focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(depth(), '6');
      depth().dispatchEvent(new Event('input', { bubbles: true }));
    });
    React.act(() => depth().blur());
    expect(depth().value).toBe('6');
    React.act(() => button("Section A").click());
    expect(depth().value).toBe('20');
    // Clicking the corresponding canvas region selects B and exposes its depth.
    pointer('pointerdown', 31.75, 41.75); pointer('pointerup', 31.75, 41.75);
    expect(depth().value).toBe('6');
    // Move the split slightly, drawing from the opposite end. The shallow
    // region must remain on the same physical side, including after undo/redo.
    React.act(() => button("Redraw split").click());
    pointer('pointerdown', 43.75, 51.75);
    if (gesture === 'clicks') {
      pointer('pointerup', 43.75, 51.75);
      pointer('pointerdown', 43.75, 31.75);
    } else pointer('pointermove', 43.75, 31.75);
    pointer('pointerup', 43.75, 31.75);
    pointer('pointerdown', 31.75, 41.75); pointer('pointerup', 31.75, 41.75);
    expect(depth().value).toBe('6');
    expect(path.getAttribute('d')).toBe(outline);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(depth().value).toBe('6');
    clickBinHistory(container, "redo");
    pointer('pointerdown', 31.75, 41.75); pointer('pointerup', 31.75, 41.75);
    expect(depth().value).toBe('6');
    React.act(() => button("Remove split").click());
    expect(depth().value).toBe('20');
    expect(container.querySelector('[data-testid="pocket-split-split-test"]')).toBeNull();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(depth().value).toBe('6');
    expect(path.getAttribute('d')).toBe(outline);
    unmount();
  });

  it("leaves no split or history entry after an invalid boundary or cancellation", async () => {
    const shape = rectangularShape("tool", "Cutter");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape],
      cutouts: [parseCutoutPlacement({ id: "split-test", shapeId: shape.id, position: { x: 0, y: 0 } })] });
    const { container, unmount } = renderPage();
    await flushHydration(); selectPocket(container, "split-test");
    React.act(() => [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Layout')!.click());
    const ruler = container.querySelector<HTMLButtonElement>('[aria-label="Measure between contours"]')!;
    React.act(() => ruler.click());
    expect(ruler.getAttribute('aria-pressed')).toBe('true');
    React.act(() => [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Split pocket')!.click());
    expect(ruler.getAttribute('aria-pressed')).toBe('false');
    const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
    Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
    Object.defineProperties(svg, {
      createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) },
      setPointerCapture: { value: () => {} },
    });
    for (const x of [31.75, 41.75]) React.act(() => {
      const event = new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: 31.75 });
      Object.defineProperty(event, 'pointerId', { value: 1 }); svg.dispatchEvent(event);
    });
    expect(container.textContent).toContain('not along its edge');
    React.act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(container.querySelector('[data-testid="pocket-split-draft"]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
    unmount();
  });

  it("switches pockets in their fixed section without changing section order or entering rename", async () => {
    const first = rectangularShape("first-shape", "Wrench");
    const second = rectangularShape("second-shape", "Pliers");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, shapes: [first, second],
      cutouts: [
        parseCutoutPlacement({ id: "first-pocket", shapeId: first.id, position: { x: -20, y: 0 }, depth: { mode: "mm", value: 10 } }),
        parseCutoutPlacement({ id: "second-pocket", shapeId: second.id, position: { x: 20, y: 0 }, depth: { mode: "mm", value: 20 } }),
      ],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    const pockets = container.querySelector<HTMLElement>('#bin-settings-pockets')!;
    const scroller = pockets.parentElement!;
    const sections = Array.from(scroller.children);
    expect(pockets.querySelector('[data-testid="pocket-selection-help"]')!.textContent).toContain('Select a pocket');
    scroller.scrollTop = 240;
    selectPocket(container, "second-pocket");
    expect(container.querySelector('[data-testid="pocket-properties-heading"]')!.textContent).toContain("Pliers");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Pocket cut depth in millimetres"]')!.value).toBe("20");
    const editor = container.querySelector<HTMLElement>('#pocket-properties')!;
    const edges = editor.querySelector<HTMLDetailsElement>('[data-testid="pocket-edge-settings"]')!;
    React.act(() => edges.querySelector('summary')!.click());
    selectPocket(container, "first-pocket");
    await React.act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(Array.from(scroller.children)).toEqual(sections);
    expect(container.querySelector('#pocket-properties')).toBe(editor);
    expect(edges.open).toBe(true);
    expect(container.querySelector('[data-testid="pocket-properties-heading"]')!.textContent).toContain("Wrench");
    expect(container.querySelector<HTMLInputElement>('[aria-label="Pocket cut depth in millimetres"]')!.value).toBe("10");
    expect(container.querySelector('[data-testid="input-shape-name"]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-rename-second-pocket"]')!.click());
    const name = container.querySelector<HTMLInputElement>('[data-testid="input-shape-name"]')!;
    expect(name.value).toBe("Pliers");
    expect(document.activeElement).toBe(name);
    expect(container.querySelector('[data-testid="pocket-properties-heading"]')!.textContent).toContain("Pliers");
    React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Discard this name');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    React.act(() => name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(container.querySelector('[data-testid="input-shape-name"]')).toBeNull();
    expect(container.querySelector('[data-testid="pocket-properties-heading"]')!.textContent).toContain("Pliers");
    unmount();
  });

  it("keeps depth first and the size, scale, and other optional settings collapsed, and opens Pockets on selection", async () => {
    const shape = rectangularShape("tool", "Wrench");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, shapes: [shape],
      cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 }, depth: { mode: "mm", value: 12 } })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    selectPocket(container, "pocket");
    const editor = container.querySelector<HTMLElement>('#pocket-properties')!;
    const pockets = container.querySelector<HTMLElement>('#bin-settings-pockets')!;
    const scroller = pockets.parentElement!;
    expect(editor.closest('#bin-settings-pockets')).toBe(pockets);
    const primaryFields = editor.querySelectorAll<HTMLInputElement>('input[type="number"]');
    expect(primaryFields[0].getAttribute('aria-label')).toBe('Pocket cut depth in millimetres');
    const size = editor.querySelector('[aria-label="Pocket size and scale"]')!;
    for (const label of ["Pocket width in millimetres", "Pocket length in millimetres", "Pocket width scale percent", "Pocket length scale percent"]) {
      expect(size.querySelector(`[aria-label="${label}"]`)!.closest('details')).toBe(size);
    }
    for (const id of ['pocket-size-settings', 'pocket-clearance-settings', 'pocket-edge-settings', 'pocket-position-settings']) {
      expect(editor.querySelector<HTMLDetailsElement>(`[data-testid="${id}"]`)!.open).toBe(false);
    }
    expect(editor.querySelector('[aria-label="Extra pocket clearance in millimetres"]')!.closest('details')!.dataset.testid).toBe('pocket-clearance-settings');
    expect(editor.lastElementChild?.getAttribute('data-testid')).toBe('pocket-clearance-settings');
    expect(editor.querySelector('[data-testid="button-inspect-pocket"]')!.closest('details')!.dataset.testid).toBe('pocket-depth-summary');
    expect(editor.querySelector<HTMLDetailsElement>('[data-testid="pocket-depth-summary"]')!.open).toBe(true);
    expect(container.querySelector('[data-testid="button-layout-edit-pocket"]')).toBeNull();
    expect(pockets.getAttribute('data-state')).toBe('open');
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
    unmount();
  });

  it("keeps bin guidance behind help buttons while retaining dimensions and save status", async () => {
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "size");
    const before = [...container.querySelectorAll<HTMLInputElement>('input[type="number"]')].map((input) => input.value);
    expect(container.textContent).not.toContain("Pitch changes preserve");
    expect(container.textContent).not.toContain("Snaps to");
    expect(container.textContent).not.toContain("Adding tools keeps these dimensions");
    expect(container.textContent).toContain("Outer size");
    expect(container.querySelector('[data-testid="project-status"] [role="status"]')!.textContent).toBe("Draft — saving locally…");
    for (const [name, explanation] of [
      ["grid pitch", "Grid pitches preserve the outer size"],
      ["width", "Snaps to 21 mm grid increments"],
      ["length", "Snaps to 21 mm grid increments"],
      ["keep bin size fixed", "Adding tools keeps these dimensions"],
    ]) {
      const help = container.querySelector<HTMLButtonElement>(`[aria-label="About ${name}"]`)!;
      React.act(() => help.click());
      expect(document.querySelector('[role="tooltip"]')!.textContent).toContain(explanation);
      React.act(() => help.click());
    }
    expect([...container.querySelectorAll<HTMLInputElement>('input[type="number"]')].map((input) => input.value)).toEqual(before);
    expect(container.querySelector('[aria-label="Keep bin size fixed"]')!.getAttribute('aria-checked')).toBe('false');
    unmount();
  });

  it.each([
    { layout: "standard", lip: "standard", height: "45.6" },
    { layout: "workflow", lip: "standard", height: "45.6" },
    { layout: "standard", lip: "none", height: "42.0" },
    { layout: "workflow", lip: "none", height: "42.0" },
  ] as const)("explains total bin height only in the dimensions hint: $layout, $lip lip", async ({ layout, lip, height }) => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT,
      spec: parseBinSpec({ ...EMPTY_PROJECT.spec, gridX: 2, gridY: 3, heightUnits: 6, lip }),
    });
    const { container, unmount } = renderPage({ experimental: false });
    try {
      await flushHydration();
      openSettingsSection(container, "size");
      const size = container.querySelector('#bin-settings-size')!;
      expect(size.textContent).toContain(`Outer size 83.5 × 125.5 × ${height} mm`);
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
      expect(size.textContent).not.toContain("Each height unit");
      const hint = size.querySelector<HTMLButtonElement>('[aria-label="About bin dimensions"]')!;
      React.act(() => hint.click());
      const explanation = document.querySelector('[role="tooltip"]')!.textContent;
      expect(explanation).toContain("bottom of the base, excluding any baseplate");
      expect(explanation).toContain("Each height unit is 7 mm, including the base");
      if (lip === "standard") {
        expect(explanation).toContain("Gridfinity Rebuilt’s 0.6 mm lip rounding");
        expect(explanation).toContain("displayed height includes this lip");
        expect(explanation).toContain("3.55 mm above the 7 × units height (4.4 mm before rounding)");
      } else {
        expect(explanation).toContain("stacking lip is off, so total height is 7 × height units");
        expect(explanation).not.toContain("3.55");
      }
      React.act(() => hint.click());
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
      expect(size.querySelector<HTMLInputElement>('[aria-label="Bin height in units"]')!.value).toBe("6");
    } finally {
      unmount();
      window.history.replaceState(null, "", originalUrl);
    }
  });

  it("keeps native slider and Manage keyboard interactions from editing the selected pocket", async () => {
    const shape = rectangularShape("tool", "Wrench");
    const pocket = parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 } });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [pocket] });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
      selectPocket(container, "pocket");
      openSettingsSection(container, "size");
      const slider = container.querySelector<HTMLElement>('[role="slider"][aria-label="Width in standard Gridfinity cells"]')!;
      const before = Number(slider.getAttribute("aria-valuenow"));
      React.act(() => {
        slider.focus();
        slider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
        slider.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
      });
      expect(Number(slider.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual([pocket]);
      const resizedSpec = vi.mocked(useBinGeometry).mock.lastCall![0];
      openSettingsSection(container, "project");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
      const dialog = document.querySelector('[role="dialog"]')!;
      const target = dialog.querySelector<HTMLButtonElement>('[data-testid="button-export-library"]')!;
      for (const key of ["ArrowDown", "r", "Delete", "z"]) {
        React.act(() => {
          target.focus();
          target.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: key === "z", bubbles: true, cancelable: true }));
        });
      }
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual([pocket]);
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toEqual(resizedSpec);
    } finally { unmount(); }
  });

  it("centers zero clearance and makes inward adjustments undoable without scaling the trace", async () => {
    const shape = rectangularShape("tool", "Wrench");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, shapes: [shape],
      cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 } })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    selectPocket(container, "pocket");
    const control = container.querySelector('[data-testid="pocket-clearance-settings"]')!;
    const slider = control.querySelector<HTMLElement>('[role="slider"]')!;
    expect(slider.getAttribute('aria-valuemin')).toBe('-2');
    expect(slider.getAttribute('aria-valuemax')).toBe('2');
    expect(slider.getAttribute('aria-valuenow')).toBe('0');
    const input = control.querySelector<HTMLInputElement>('input')!;
    React.act(() => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '-0.5');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    React.act(() => input.blur());
    expect(slider.getAttribute('aria-valuenow')).toBe('-0.5');
    expect(container.querySelector<HTMLInputElement>('[aria-label="Pocket width in millimetres"]')!.value).toBe('29');
    expect(container.querySelector<HTMLInputElement>('[aria-label="Pocket width scale percent"]')!.value).toBe('100');
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(input.value).toBe('0');
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
    unmount();
  });

  it.each([30, 17.000000000000007])("edits physical dimensions from %s mm with linked proportions and undoes the committed value once", async originalWidth => {
    const shape = rectangularShape("tool", "Wrench");
    shape.bboxMm.minX = -originalWidth / 2;
    shape.bboxMm.maxX = originalWidth / 2;
    shape.outlineMm[0].outer = shape.outlineMm[0].outer.map(point => ({ ...point, x: Math.sign(point.x) * originalWidth / 2 }));
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, shapes: [shape],
      cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 } })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "tool-cutouts");
    selectPocket(container, "pocket");
    const width = container.querySelector<HTMLInputElement>('[aria-label="Pocket width in millimetres"]')!;
    const length = container.querySelector<HTMLInputElement>('[aria-label="Pocket length in millimetres"]')!;
    React.act(() => {
      width.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(width, '40');
      width.dispatchEvent(new Event('input', { bubbles: true }));
    });
    React.act(() => width.blur());
    expect(width.value).toBe('40');
    expect(Number(length.value)).toBeCloseTo(20 * 40 / originalWidth, 2);
    const undo = container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!;
    React.act(() => undo.click());
    expect(Number(width.value)).toBeCloseTo(originalWidth, 2);
    expect(length.value).toBe('20');
    expect(undo.disabled).toBe(true);
    unmount();
  });

  it.each(["tap", "jitter", "drag", "cancel"] as const)(
    "%s on a pocket opens its fixed settings only for a click and leaves meaningful undo history",
    async (gesture) => {
      const shape = rectangularShape("tool", "Wrench");
      vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
        ...EMPTY_PROJECT, shapes: [shape],
        cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 1.25, y: 0 } })],
      });
      let controls: ReturnType<typeof usePanelState>;
      function PanelProbe() { controls = usePanelState(); return null; }
      const { container, unmount } = render(
        <PanelProvider><PanelProbe /><ShapeLibraryProvider><BinDesignerPage /></ShapeLibraryProvider></PanelProvider>,
        { mobile: gesture === 'tap' },
      );
      await flushHydration();
      // Start from another section with this pocket already selected: clicking
      // it again must still return to its settings.
      if (gesture !== 'tap') {
        selectPocket(container, "pocket");
        openSettingsSection(container, "materials");
      }
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
      React.act(() => controls.setPanelOpen(false));
      const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
      const scene = svg.querySelector('g')!;
      const pocket = svg.querySelector('[data-cutout-id="pocket"]')!;
      const before = pocket.getAttribute('d');
      // jsdom lacks SVG coordinate mapping and pointer capture. Identity mapping
      // gives a 1 px/mm canvas, with the 83.5 mm bin centred at (41.75, 41.75).
      Object.defineProperty(scene, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
      Object.defineProperties(svg, {
        createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) },
        setPointerCapture: { value: () => {} },
      });
      const pointer = (type: string, x: number) => React.act(() => {
        const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 41.75, altKey: true });
        Object.defineProperty(event, 'pointerId', { value: 1 });
        pocket.dispatchEvent(event);
      });
      pointer('pointerdown', 43);
      if (gesture === 'drag') {
        pointer('pointermove', 55);
        const args = vi.mocked(useBinGeometry).mock.lastCall!;
        expect(args[2]!.cutouts[0].position.x).toBe(1.25);
        expect(args[5]!.layout.cutouts[0].position.x).not.toBe(1.25);
        expect(args[5]!.gesture).toBeDefined();
        pointer('pointermove', 57);
        expect(vi.mocked(useBinGeometry).mock.lastCall![5]!.gesture).toBe(args[5]!.gesture);
      }
      if (gesture === 'jitter') pointer('pointermove', 44);
      pointer(gesture === 'cancel' ? 'pointercancel' : 'pointerup', gesture === 'drag' ? 55 : gesture === 'jitter' ? 44 : 43);
      expect(vi.mocked(useBinGeometry).mock.lastCall![5]!.gesture).toBeUndefined();
      expect(controls!.panelOpen).toBe(gesture === 'jitter');
      if (gesture === 'tap') {
        expect(container.querySelector('.mobile-adjustment-tray')).toBeNull();
        React.act(() => [...container.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Adjust')!.click());
        expect(container.querySelector('.mobile-adjustment-tray')?.textContent).toContain('Wrench');
        expect(container.querySelector('#quick-pocket-depth')).not.toBeNull();
      }
      if (gesture === 'jitter') {
        expect(document.querySelector('#bin-settings-pockets')!.getAttribute('data-state')).toBe('open');
        expect(document.querySelector('[data-testid="pocket-properties-heading"]')!.textContent).toContain('Wrench');
      }
      expect(container.querySelector('[data-testid="button-layout-edit-pocket"]')).toBeNull();
      const undo = container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!;
      expect(undo.disabled).toBe(gesture !== 'drag');
      if (gesture === 'drag') {
        expect(pocket.getAttribute('d')).not.toBe(before);
        React.act(() => undo.click());
      }
      expect(pocket.getAttribute('d')).toBe(before);
      if (gesture === 'tap') {
        const cutoutBefore = vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0];
        const slider = container.querySelector('#quick-pocket-depth [role="slider"]')!;
        React.act(() => slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
        expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0].depth).not.toEqual(cutoutBefore.depth);
        React.act(() => undo.click());
        expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0].depth).toEqual(cutoutBefore.depth);
        React.act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Export')!.click());
        expect(document.querySelector('#bin-settings-export')).not.toBeNull();
        expect(document.querySelector('#bin-settings-pockets')).toBeNull();
        expect(document.querySelector('#bin-settings-size')).toBeNull();
        const exports = document.querySelector('#bin-settings-export')!;
        expect(exports.querySelector('[data-testid="button-export-stl"]')).not.toBeNull();
        expect(exports.querySelector('[data-testid="button-export-3mf"]')).not.toBeNull();
        expect(exports.querySelector('[data-testid="button-export-surface-fit-test"]')).toBeNull();
        await React.act(async () => exports.querySelector<HTMLButtonElement>('[data-testid="button-export-open-fit-check"]')!.click());
        const fitChecks = document.querySelector('#bin-settings-fit')!;
        expect(fitChecks.textContent).toContain('Wrench');
        for (const [id, title] of [["button-export-surface-fit-test", "Save surface fit test STL?"], ["button-export-fit-check", "Save fit template STL?"]]) {
          React.act(() => fitChecks.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!.click());
          expect([...document.querySelectorAll('[role="dialog"]')].some(dialog => dialog.textContent?.includes(title))).toBe(true);
          expect(downloadBlob).not.toHaveBeenCalled();
          React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === "Cancel")!.click());
        }
        React.act(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Back to Canvas')!.click());
        React.act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Adjust')!.click());
        React.act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'All properties')!.click());
        expect(document.querySelector('#bin-settings-pockets')).not.toBeNull();
        expect(document.querySelector('#bin-settings-size')).not.toBeNull();
      }
      unmount();
    },
  );

  it.each([
    { rotationDeg: 0, mirrored: false, cancel: false },
    { rotationDeg: 35, mirrored: true, cancel: false },
    { rotationDeg: 35, mirrored: false, cancel: true },
  ])("grabs an enlarged mobile resize target without jumping ($rotationDeg degrees, mirrored=$mirrored, cancel=$cancel)", async ({ rotationDeg, mirrored, cancel }) => {
    const shape = rectangularShape("tool", "Wrench");
    const original = parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 },
      rotationDeg, mirrored, scaleX: 1.5, scaleY: 0.8, aspectRatioLocked: false });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [original] });
    const { container, unmount } = renderPage({ mobile: true });
    try {
      await flushHydration();
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
      const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
      Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
      Object.defineProperties(svg, {
        createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) },
        setPointerCapture: { value: () => {} },
      });
      const pointer = (type: string, x: number, y: number) => React.act(() => {
        const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
        Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: "touch" } });
        svg.dispatchEvent(event);
      });
      pointer("pointerdown", 41.75, 41.75); pointer("pointerup", 41.75, 41.75);
      const handles = [...svg.querySelectorAll<SVGRectElement>('[data-pocket-resize-handle]')];
      const center = (handle: SVGRectElement) => ({ x: +handle.getAttribute('x')! + +handle.getAttribute('width')! / 2,
        y: +handle.getAttribute('y')! + +handle.getAttribute('height')! / 2 });
      expect(handles).toHaveLength(8);
      for (const handle of handles) {
        expect(+handle.getAttribute('width')!).toBe(28);
        for (const other of handles.filter(other => other !== handle)) {
          expect(Math.hypot(center(handle).x - center(other).x, center(handle).y - center(other).y)).toBeGreaterThanOrEqual(48 - 1e-6);
        }
      }
      const east = center(svg.querySelector<SVGRectElement>('[data-pocket-resize-handle="e"]')!);
      const radius = Math.hypot(east.x - 41.75, east.y - 41.75);
      const direction = { x: (east.x - 41.75) / radius, y: (east.y - 41.75) / radius };
      const at = (offset: number) => [east.x + direction.x * offset, east.y + direction.y * offset] as const;
      const current = () => vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0];
      const undo = container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!;
      // Grab outside the visible square, jitter, and release: no resize or undo entry.
      pointer("pointerdown", ...at(24)); pointer("pointermove", ...at(27)); pointer("pointerup", ...at(27));
      expect(current()).toEqual(original); expect(undo.disabled).toBe(true);
      const pocket = svg.querySelector('[data-cutout-id="pocket"]')!;
      const before = pocket.getAttribute('d');
      pointer("pointerdown", ...at(24)); pointer("pointermove", ...at(36));
      expect(pocket.getAttribute('d')).not.toBe(before);
      pointer(cancel ? "pointercancel" : "pointerup", ...at(36));
      if (!cancel) {
        expect(current().scaleX).toBeCloseTo(1.9); // 45 mm + 12 mm, not the distance to the enlarged handle.
        expect(current().scaleY).toBe(0.8);
        expect(current().rotationDeg).toBe(rotationDeg);
        expect(undo.disabled).toBe(false); React.act(() => undo.click());
      }
      expect(current()).toEqual(original); expect(undo.disabled).toBe(true);
      expect(pocket.getAttribute('d')).toBe(before);
    } finally { unmount(); }
  });

  it("edits and finishes a selected contour directly in Layout, including after using the ruler", async () => {
    const shape = rectangularShape("tool", "Wrench");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, shapes: [shape],
      cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 } })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    expect(container.querySelector('[data-testid="button-layout-edit-contour"]')).toBeNull();
    openSettingsSection(container, "tool-cutouts");
    selectPocket(container, "pocket");
    const edit = container.querySelector<HTMLButtonElement>('[data-testid="button-layout-edit-contour"]')!;
    expect(edit.closest('[data-testid="layout-tool-toolbar"]')).not.toBeNull();
    expect(edit.previousElementSibling?.getAttribute('aria-label')).toBe('Object controls');
    expect(container.querySelector('[data-testid="button-edit-contour"]')!.closest('[data-testid="pocket-properties-heading"]')).not.toBeNull();
    expect(edit.textContent).toBe("");
    expect(edit.getAttribute("aria-label")).toBe("Edit contour");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-layout-ruler"]')!.click());
    expect(container.querySelector('[data-testid="layout-ruler-status"]')).not.toBeNull();
    React.act(() => edit.click());
    expect(edit.getAttribute("aria-label")).toBe("Finish contour editing");
    expect(edit.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[data-testid="layout-ruler-status"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid="contour-vertex-handle"]')).toHaveLength(4);
    expect(container.querySelector('[data-testid="button-edit-contour"]')!.getAttribute("aria-label")).toBe("Finish contour editing");
    React.act(() => edit.click());
    expect(edit.textContent).toBe("");
    expect(edit.getAttribute("aria-label")).toBe("Edit contour");
    expect(container.querySelector('[data-testid="contour-vertex-handle"]')).toBeNull();
    expect(container.querySelector('[data-testid="pocket-resize-handle-ne"]')).not.toBeNull();
    unmount();
  });

  it.each([
    { ringIndex: -1, mirrored: false }, { ringIndex: 0, mirrored: false },
    { ringIndex: -1, mirrored: true }, { ringIndex: 0, mirrored: true },
  ])("focuses desktop ring $ringIndex (mirrored: $mirrored) while preserving mouse edits and near-edge insertion", async ({ ringIndex, mirrored }) => {
    const shape = rectangularShape("tool", "Wrench");
    shape.outlineMm[0].holes = [[{ x: -7, y: -4 }, { x: -7, y: 4 }, { x: 7, y: 4 }, { x: 7, y: -4 }]];
    shape.pointCount = 8;
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, shapes: [shape],
      cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 }, rotationDeg: 30, scaleX: 1.5, scaleY: 0.8, mirrored })],
    });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "tool-cutouts"); selectPocket(container, "pocket");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-edit-contour"]')!.click());
      const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
      Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse: () => ({}) }) });
      Object.defineProperties(svg, {
        createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) },
        setPointerCapture: { value: () => {} },
      });
      const handles = () => svg.querySelectorAll(`[data-contour-ring="${ringIndex}"]`);
      const coords = (element: Element) => ({ x: Number(element.getAttribute('cx')), y: Number(element.getAttribute('cy')) });
      const pointer = (target: Element, type: string, point: { x: number; y: number }) => React.act(() => {
        const event = new MouseEvent(type, { bubbles: true, button: type === 'pointermove' ? -1 : 0, clientX: point.x, clientY: point.y });
        Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
        target.dispatchEvent(event);
      });
      const remove = () => [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Delete point');
      const first = coords(handles()[0]);
      pointer(handles()[0], 'pointerdown', first);
      expect(container.querySelector('[data-testid="contour-magnifier"]')).not.toBeNull();
      pointer(svg, 'pointerup', first);
      expect(container.querySelector('[data-testid="contour-magnifier"]')).toBeNull();
      expect(handles()[0].getAttribute('data-point-selected')).toBe('true');
      expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
      pointer(handles()[0], 'pointerdown', first);
      const moved = { x: first.x + 10, y: first.y + 10 };
      pointer(svg, 'pointermove', moved); pointer(svg, 'pointerup', moved);
      expect(coords(handles()[0]).x).toBeCloseTo(moved.x);
      React.act(() => remove()!.click());
      expect(handles()).toHaveLength(3);
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(handles()).toHaveLength(4);
      const rightClick = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
      React.act(() => handles()[0].dispatchEvent(rightClick));
      expect(rightClick.defaultPrevented).toBe(true);
      expect(document.querySelector('[role="menu"]')).toBeNull();
      expect(handles()).toHaveLength(3);
      expect(remove()).toBeUndefined();
      // A triangle and empty canvas consume right-clicks without another edit.
      React.act(() => handles()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })));
      const emptyClick = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 1000, clientY: 1000 });
      React.act(() => svg.dispatchEvent(emptyClick));
      expect(emptyClick.defaultPrevented).toBe(true);
      expect(document.querySelector('[role="menu"]')).toBeNull();
      expect(handles()).toHaveLength(3);
      pointer(handles()[0], 'pointerdown', coords(handles()[0])); pointer(svg, 'pointerup', coords(handles()[0]));
      expect(remove()!.disabled).toBe(true);
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      const vertices = [...handles()].map(coords);
      const [a, b] = vertices.map((point, index) => [point, vertices[(index + 1) % vertices.length]])
        .sort(([a, b], [c, d]) => Math.hypot(d.x - c.x, d.y - c.y) - Math.hypot(b.x - a.x, b.y - a.y))[0];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const midpoint = { x: (a.x + b.x) / 2 + (b.y - a.y) / length * 2,
        y: (a.y + b.y) / 2 - (b.x - a.x) / length * 2 };
      // Miss the path while staying closer to this edge than the other ring (4.8px away).
      pointer(svg, 'pointerdown', midpoint);
      pointer(svg, 'pointerup', midpoint);
      expect(handles()).toHaveLength(5);
      expect(remove()).toBeDefined();
      expect(coords(svg.querySelector('[data-point-selected="true"]')!).x).toBeCloseTo(midpoint.x);
      expect(coords(svg.querySelector('[data-point-selected="true"]')!).y).toBeCloseTo(midpoint.y);
      const nearVertex = { x: coords(handles()[0]).x + 1, y: coords(handles()[0]).y + 1 };
      pointer(svg, 'pointerdown', nearVertex); pointer(svg, 'pointerup', nearVertex);
      expect(handles()).toHaveLength(5);
      expect(handles()[0].getAttribute('data-point-selected')).toBe('true');
      pointer(svg, 'pointerdown', { x: 1000, y: 1000 }); pointer(svg, 'pointerup', { x: 1000, y: 1000 });
      expect(handles()).toHaveLength(5);
    } finally { unmount(); }
  });

  it.each([-1, 0])("selects and deletes contour ring %s points with undo, minimum size, and direct dragging", async (ringIndex) => {
    const shape = rectangularShape("tool", "Wrench");
    shape.outlineMm[0].holes = [[{ x: -7, y: -4 }, { x: -7, y: 4 }, { x: 7, y: 4 }, { x: 7, y: -4 }]];
    shape.pointCount = 8;
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, shapes: [shape],
      cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 }, rotationDeg: 30, scaleX: 1.5, scaleY: 0.8 })],
    });
    const { container, unmount } = renderPage({ mobile: true });
    try {
      await flushHydration();
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
      React.act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Adjust')!.click());
      React.act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'All properties')!.click());
      openSettingsSection(document.body, "tool-cutouts");
      selectPocket(document.body, "pocket");
      React.act(() => document.querySelector<HTMLButtonElement>('[data-testid="button-edit-contour"]')!.click());
      const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
      Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse: () => ({}) }) });
      Object.defineProperties(svg, {
        createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) },
        setPointerCapture: { value: () => {} },
      });
      const ringHandles = () => svg.querySelectorAll(`[data-contour-ring="${ringIndex}"]`);
      const otherHandles = () => svg.querySelectorAll(`[data-contour-ring="${ringIndex === -1 ? 0 : -1}"]`);
      const deleteButton = () => [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Contour editing tools"] button')].find(button => button.textContent === 'Delete point');
      const pointer = (target: Element, type: string, x: number, y: number) => React.act(() => {
        const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
        Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'touch' } });
        target.dispatchEvent(event);
      });
      const tapNearFirst = () => {
        const first = ringHandles()[0];
        // Picking uses screen distance, including rotated and stretched pockets.
        pointer(svg, 'pointerdown', Number(first.getAttribute('cx')) - 2, Number(first.getAttribute('cy')));
        pointer(svg, 'pointerup', Number(first.getAttribute('cx')) - 2, Number(first.getAttribute('cy')));
      };
      const original = svg.querySelector('[data-cutout-id="pocket"]')!.getAttribute('d');
      expect(deleteButton()).toBeUndefined();
      tapNearFirst();
      expect(ringHandles()).toHaveLength(4);
      expect(svg.querySelectorAll('[data-point-selected="true"]')).toHaveLength(1);
      React.act(() => deleteButton()!.click());
      expect(ringHandles()).toHaveLength(3);
      expect(otherHandles()).toHaveLength(4);
      tapNearFirst();
      expect(deleteButton()!.disabled).toBe(true);
      React.act(() => deleteButton()!.click());
      pointer(svg, 'pointerdown', 1000, 1000);
      pointer(svg, 'pointerup', 1000, 1000);
      expect(deleteButton()).toBeUndefined();
      expect(ringHandles()).toHaveLength(3);
      expect(otherHandles()).toHaveLength(4);
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(ringHandles()).toHaveLength(4);
      expect(svg.querySelector('[data-cutout-id="pocket"]')!.getAttribute('d')).toBe(original);
      expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
      clickBinHistory(container, "redo");
      expect(ringHandles()).toHaveLength(3);
      const first = ringHandles()[0];
      const x = Number(first.getAttribute('cx')), y = Number(first.getAttribute('cy'));
      pointer(first, 'pointerdown', x, y);
      pointer(svg, 'pointermove', x + 10, y + 10);
      pointer(svg, 'pointerup', x + 10, y + 10);
      expect(ringHandles()).toHaveLength(3);
      expect(Number(ringHandles()[0].getAttribute('cx'))).toBeCloseTo(x + 10);
      const finish = toolButton(container, 'Finish contour editing');
      React.act(() => finish.click());
      expect(container.querySelector('[aria-label="Contour editing tools"]')).toBeNull();
      const edit = toolButton(container, 'Edit contour');
      React.act(() => edit.click());
      expect(deleteButton()).toBeUndefined();
    } finally { unmount(); }
  });

  it.each([false, true])("preserves tilted seats across depth-mode changes and measures the selected region (split=%s)", async split => {
    const shape = rectangularShape("tool", "Tilted depth test");
    const spec = parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 8, lip: "none" });
    const original = parseCutoutPlacement({ id: "tilted", shapeId: shape.id, position: { x: 0, y: 0 }, tilt: { xDeg: 25, yDeg: 20 }, depth: { mode: "remaining", floorThicknessMm: 10 },
      ...(split ? { split: { boundary: [{ x: -15, y: 0 }, { x: 15, y: 0 }], depths: [{ mode: "remaining", floorThicknessMm: 10 }, { mode: "remaining", floorThicknessMm: 20 }] } } : {}) });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec, shapes: [shape], cutouts: [original] });
    const { container, unmount } = renderPage();
    await flushHydration();
    try {
      selectPocket(container, original.id);
      const regions = original.split ? resolvePocketSplit(shape.outlineMm, original.split.boundary).regions! : [shape.outlineMm];
      const changeMode = (label: string) => {
        const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Pocket depth mode"]')!;
        React.act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
        const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent === label)!;
        React.act(() => option.click());
      };
      regions.forEach((outlineMm, index) => {
        if (split) React.act(() => [...container.querySelectorAll('button')].find(button => button.textContent === `Section ${index === 0 ? "A" : "B"}`)!.click());
        const depth = original.split?.depths[index] ?? original.depth;
        const expected = resolvePlacedPocketDepth(spec, depth, { outlineMm }, original);
        changeMode("Fixed depth");
        const changed = vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0];
        const actualDepth = changed.split?.depths[index] ?? changed.depth;
        expect(actualDepth.mode).toBe("mm");
        expect(actualDepth.mode === "mm" ? actualDepth.value : NaN).toBeCloseTo(expected.axialDepthMm!, 8);
        expect(container.querySelector('[data-testid="pocket-depth-summary"]')!.textContent).toContain(`Floor: ${expected.floorZ!.toFixed(1)} mm`);
        expect(container.querySelector('[data-testid="pocket-depth-summary"]')!.textContent).toContain(`Vertical depth: ${expected.depthMm!.toFixed(1)} mm`);
        changeMode("Keep floor thickness");
        const restored = vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0];
        const restoredDepth = restored.split?.depths[index] ?? restored.depth;
        expect(restoredDepth.mode === "remaining" ? restoredDepth.floorThicknessMm : NaN).toBeCloseTo(expected.floorZ!, 8);
      });
    } finally { unmount(); }
  });

  it.each(["standard","workflow"])("groups tilted insertion controls in a collapsed section above pocket depth in %s layout", async layout => {
    const originalUrl = window.location.href;
    window.history.replaceState(null,"",`/bin?layout=${layout}`);
    const shape = rectangularShape("tool","Tilted tool");
    const pocket = parseCutoutPlacement({id:"tilted",shapeId:shape.id,position:{x:0,y:0},
      elevationMm:7,tilt:{xDeg:20,yDeg:25},insertionMode:"axis",depth:{mode:"mm",value:16}});
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({...EMPTY_PROJECT,shapes:[shape],cutouts:[pocket]});
    const {container,unmount} = renderPage();
    try {
      await flushHydration();
      selectPocket(container,pocket.id);
      const controls = document.querySelector<HTMLDetailsElement>('[data-testid="pocket-insertion-controls"]')!;
      expect(controls).not.toBeNull();
      expect(controls.open).toBe(false);
      expect(controls.querySelector("summary")!.textContent).toBe("Insertion path");
      React.act(() => controls.querySelector("summary")!.click());
      expect(controls.open).toBe(true);
      const depth = document.querySelector('[data-testid="pocket-depth-summary"]')!;
      expect(controls.compareDocumentPosition(depth) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(controls.querySelector<HTMLInputElement>('input')!.checked).toBe(true);
      expect(controls.querySelector('select')!.value).toBe("axis");
      React.act(() => controls.querySelector("summary")!.click());
      expect(controls.open).toBe(false);
    } finally { unmount(); window.history.replaceState(null,"",originalUrl); }
  });

  it.each([false,true])("keeps the original object when selecting Through and restoring fixed depth (split=%s)", async split => {
    const shape = rectangularShape("tool","Through source");
    const spec = parseBinSpec({gridX:4,gridY:4,heightUnits:6,lip:"none"});
    const original = parseCutoutPlacement({id:"through-source",shapeId:shape.id,position:{x:0,y:0},
      elevationMm:12,tilt:{xDeg:20,yDeg:25},depth:{mode:"mm",value:16},
      ...(split ? {split:{boundary:[{x:-15,y:0},{x:15,y:0}],depths:[{mode:"mm",value:10},{mode:"mm",value:16}]}} : {})});
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({...EMPTY_PROJECT,spec,shapes:[shape],cutouts:[original]});
    const {container,unmount} = renderPage();
    await flushHydration();
    try {
      selectPocket(container,original.id);
      const changeMode = (label: string) => {
        React.act(()=>container.querySelector<HTMLButtonElement>('[aria-label="Pocket depth mode"]')!
          .dispatchEvent(new KeyboardEvent("keydown",{key:" ",bubbles:true})));
        React.act(()=>[...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node=>node.textContent === label)!.click());
      };
      changeMode("Through");
      const through = vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0];
      expect(through.elevationMm).toBe(12);
      expect(through.position).toEqual(original.position);
      expect(through.tilt).toEqual(original.tilt);
      expect(through.split?.depths[0] ?? through.depth).toEqual({mode:"through",sourceDepthMm:split ? 10 : 16});
      if (split) expect(through.split!.depths[1]).toEqual(original.split!.depths[1]);
      changeMode("Fixed depth");
      const restored = vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0];
      expect(restored.split?.depths ?? restored.depth).toEqual(original.split?.depths ?? original.depth);
    } finally { unmount(); }
  });

  it("exports restored material colors and depths in the 3MF and attached project backup", async () => {
    const materials = { ...DEFAULT_BIN_MATERIALS, binColor: "#123456",
      pocketFloorColor: "#abcdef", stackingRimColor: "#654321",
      pocketFloorThicknessMm: 1.2, stackingRimThicknessMm: 2.5, borderWidthMm: 3 };
    const doc = { ...EMPTY_PROJECT, spec: { ...EMPTY_PROJECT.spec, fill: "none" as const, lip: "none" as const }, materials };
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(doc);
    const mesh = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]), normals: null };
    binGeometryMock.hasPocketFloor = true;
    binGeometryMock.buildOnce.mockResolvedValue({ mesh, materialMeshes: { body: mesh, pocketFloors: mesh, stackingRim: mesh } });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "export");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-export-3mf"]')!.click());
      React.act(() => document.querySelector<HTMLButtonElement>('[data-testid="checkbox-export-project"]')!.click());
      await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-export-multicolor-3mf"]')!.click());
      expect(binGeometryMock.buildOnce).toHaveBeenLastCalledWith(expect.any(Object), {
        pocketFloorMaterialThicknessMm: 1.2, stackingRimMaterialThicknessMm: 2.5, borderWidthMm: 3,
      });
      const [backup, model] = vi.mocked(downloadBlob).mock.calls;
      const json = await new Promise<string>(resolve => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(backup[0]);
      });
      expect(parseProjectDoc(JSON.parse(json))!.materials).toEqual(materials);
      const buffer = await new Promise<ArrayBuffer>(resolve => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.readAsArrayBuffer(model[0]);
      });
      const xml = strFromU8(unzipSync(new Uint8Array(buffer))["3D/3dmodel.model"]);
      for (const color of ["#123456FF", "#ABCDEFFF", "#654321FF"]) expect(xml).toContain(`color="${color}"`);
      openSettingsSection(container, "project");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-new-project"]')!.click());
      await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-new-project"]')!.click());
      expect(container.querySelector('[data-testid="bin-viewport-stub"]')!.getAttribute("data-bin-color")).toBe(DEFAULT_BIN_MATERIALS.binColor);
    } finally { unmount(); }
  });});

it.each(['standard', 'workflow'])('keeps pocket depth controls inside the depth disclosure in the %s layout', async layout => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, '', `/bin?layout=${layout}`);
  const shape = rectangularShape('depth-group-shape', 'Depth tool');
  const pocket = parseCutoutPlacement({ id: 'depth-group', shapeId: shape.id, position: { x: 0, y: 0 }, depth: { mode: 'mm', value: 12 } });
  const splitPocket = parseCutoutPlacement({ id: 'depth-split', shapeId: shape.id, position: { x: 25, y: 0 }, depth: { mode: 'mm', value: 10 },
    split: { boundary: [{ x: -15, y: 0 }, { x: 15, y: 0 }], depths: [{ mode: 'mm', value: 10 }, { mode: 'mm', value: 6 }] } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [pocket, splitPocket] });
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    selectPocket(container, pocket.id);
    const group = container.querySelector<HTMLDetailsElement>('[data-testid="pocket-depth-summary"]')!;
    const input = container.querySelector<HTMLInputElement>('[aria-label="Pocket cut depth in millimetres"]')!;
    expect(input.closest('details')).toBe(group);
    expect(group.querySelector('[aria-label="Pocket depth mode"]')).not.toBeNull();
    expect(group.querySelector('[data-testid="button-inspect-pocket"]')).not.toBeNull();
    expect(group.open).toBe(true);
    expect(group.querySelector('summary')!.textContent).toBe('Depth');
    expect(container.querySelector('[data-testid="inspector-active-tool"]')).toBeNull();
    expect(container.querySelector('[data-testid="pocket-properties-heading"]')!.textContent).toContain('Pocket properties');
    React.act(() => {
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '14');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    React.act(() => input.blur());
    expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0].depth).toEqual({ mode: 'mm', value: 14 });
    React.act(() => group.querySelector('summary')!.click());
    expect(group.open).toBe(false);
    expect(group.querySelector('summary')!.textContent).toBe('Depth');
    expect(group.textContent).toContain('Cut depth: 14.0 mm');
    React.act(() => group.querySelector('summary')!.click());
    expect(input.value).toBe('14');
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0].depth).toEqual({ mode: 'mm', value: 12 });
    selectPocket(container, pocket.id);
    expect(container.querySelector<HTMLInputElement>('[aria-label="Pocket cut depth in millimetres"]')!.value).toBe('12');
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
    const currentGroup = () => container.querySelector<HTMLDetailsElement>('[data-testid="pocket-depth-summary"]')!;
    React.act(() => currentGroup().querySelector('summary')!.click());
    expect(currentGroup().open).toBe(false);
    selectPocket(container, splitPocket.id);
    expect(currentGroup().open).toBe(true);
    expect(currentGroup().querySelector('summary')!.textContent).toBe('Depth');
    const sectionButtons = container.querySelector('[role="group"][aria-label="Section to edit"]')!;
    expect(sectionButtons.closest('details')).toBe(currentGroup());
    expect(container.querySelector('[data-testid="pocket-split-settings"]')!.contains(sectionButtons)).toBe(false);
    const sectionB = [...sectionButtons.querySelectorAll('button')].find(button => button.textContent === 'Section B')!;
    React.act(() => sectionB.click());
    expect(sectionB.getAttribute('aria-pressed')).toBe('true');
    expect(currentGroup().open).toBe(true);
    expect(currentGroup().querySelector<HTMLInputElement>('[aria-label="Pocket cut depth in millimetres"]')!.value).toBe('6');
    React.act(() => currentGroup().querySelector('summary')!.click());
    expect(currentGroup().open).toBe(false);
    selectPocket(container, pocket.id);
    expect(currentGroup().open).toBe(true);
  } finally { unmount(); window.history.replaceState(null, '', originalUrl); }
});

it("explains mixed pocket and hole batch depths and offsets without changing their roles", async () => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, "", "/bin?layout=workflow");
  const shape = rectangularShape("batch-roles", "Object");
  const pocket = parseCutoutPlacement({id:"batch-pocket",shapeId:shape.id,position:{x:-20,y:0},depth:{mode:"mm",value:15}});
  const hole = parseCutoutPlacement({id:"batch-hole",shapeId:shape.id,role:"hole",position:{x:20,y:0},depth:{mode:"through"}});
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({...EMPTY_PROJECT,shapes:[shape],cutouts:[hole,pocket]});
  const {container,unmount}=renderPage();
  try {
    await flushHydration();
    openSettingsSection(container,"tool-cutouts");
    selectPocket(container,pocket.id);
    React.act(()=>container.querySelector<HTMLButtonElement>('[data-testid="button-select-batch-hole"]')!.dispatchEvent(new MouseEvent("click",{bubbles:true,ctrlKey:true})));
    const batch=container.querySelector('[data-testid="batch-properties"]')!;
    expect(batch.textContent).toContain("2 selected pockets and holes");
    expect(batch.textContent).toContain("Fixed cut and kept depth");
    expect(batch.textContent).toContain("Pocket clearance and hole offset");
    expect(batch.textContent).toContain("Positive hole offset keeps more material");
    const input=container.querySelector<HTMLInputElement>('[aria-label="Fixed cut and kept depth for selected pockets and holes"]')!;
    React.act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"8");input.dispatchEvent(new Event("input",{bubbles:true}));});
    React.act(()=>input.closest("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
    const current=vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts;
    expect(current.map(c=>c.depth)).toEqual([{mode:"mm",value:8},{mode:"mm",value:8}]);
    expect(current.find(c=>c.id===hole.id)!.role).toBe("hole");
    expect(current.find(c=>c.id===pocket.id)!.role).toBeUndefined();
  } finally {unmount();window.history.replaceState(null,"",originalUrl);}
});

it.each(["standard", "workflow"])("restores full hole protection from fixed or bottom-limited depth in %s layout", async layoutMode => {
  const originalUrl = window.location.href;
  window.history.replaceState(null,"",`/bin?layout=${layoutMode}`);
  const shape=rectangularShape("full-hole-shape","Retained hole");
  const hole=parseCutoutPlacement({id:"full-hole",shapeId:shape.id,role:"hole",position:{x:0,y:0},depth:{mode:"mm",value:5}});
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({...EMPTY_PROJECT,shapes:[shape],cutouts:[hole]});
  const {container,unmount}=renderPage();
  try {
    await flushHydration();selectPocket(container,hole.id);
    const current=()=>vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0];
    const changeMode=(label:string)=>{
      React.act(()=>container.querySelector<HTMLButtonElement>('[aria-label="Hole depth mode"]')!.dispatchEvent(new KeyboardEvent("keydown",{key:" ",bubbles:true})));
      const option=[...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node=>node.textContent===label)!;
      React.act(()=>option.click());
    };
    changeMode("Keep full depth");
    expect(current().depth).toEqual({mode:"through"});
    expect(current().elevationMm).toBeUndefined();
    expect(resolvePlacedPocketDepth(EMPTY_PROJECT.spec,current().depth,shape,current()).depthMm).toBeNull();
    clickBinHistory(container,"undo");
    expect(current().depth).toEqual({mode:"mm",value:5});
    changeMode("Set bottom height");
    expect(current().depth.mode).toBe("remaining");
    changeMode("Keep full depth");
    expect(current().depth).toEqual({mode:"through"});
    expect(current().elevationMm).toBeUndefined();
    expect(container.querySelector('[aria-label="Hole depth mode"]')!.textContent).toContain("Keep full depth");
  } finally {unmount();window.history.replaceState(null,"",originalUrl);}
});
