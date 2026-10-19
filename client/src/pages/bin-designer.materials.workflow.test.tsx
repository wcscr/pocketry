import {
  binGeometryMock,
  projectToast,
  EMPTY_PROJECT,
  rectangularShape,
  flushHydration,
  BinDesignerPage,
  render,
  renderPage,
  openSettingsSection,
  selectPocket,
} from "./bin-designer.test-support";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { PanelProvider, usePanelState } from "@/components/layout/panel-context";
import { ShapeLibraryProvider } from "@/state/shape-library";
import { DEFAULT_BIN_MATERIALS } from "@shared/gridfinity/materials";
import { fingerHoleSchema, resolvePocketDepth, parseCutoutPlacement } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { downloadBlob } from "@/lib/download";
import { useBinGeometry } from "@/lib/gridfinity/use-bin-geometry";
import * as ProjectPersistence from "@/lib/project/persist";

describe("BinDesignerPage", () => {

  it("shows preview processing beside the size controls after a short delay", async () => {
    binGeometryMock.building = true;
    binGeometryMock.progress = 0.4;
    const { container, unmount } = renderPage();
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 170)); });

    expect(
      container.querySelector('[data-testid="bin-size-preview-status"]')?.textContent,
    ).toContain("Updating 3D preview");
    expect(
      container.querySelector("#bin-settings-export")?.textContent,
    ).toContain("Updating");
    unmount();
  });

  it("withholds model volume while a rounded preview is still a draft", () => {
    binGeometryMock.previewIsDraft = true;
    binGeometryMock.building = true;
    const { container, unmount } = renderPage();
    try {
      openSettingsSection(container, "export");
      const panel = container.querySelector("#bin-settings-export")!;
      expect(panel.textContent).toContain("Model volume will appear when details are ready");
      expect(panel.textContent).not.toContain("cm³ model volume");
      // A preview approximation never disables the independent full-quality export.
      const exportButton = container.querySelector<HTMLButtonElement>('[data-testid="button-export-3mf"]');
      expect(exportButton).not.toBeNull();
      expect(exportButton!.disabled).toBe(false);
    } finally { unmount(); }
  });

  it("retains previous exact volume with an explicit updating label", () => {
    binGeometryMock.statsAreStale = true;
    binGeometryMock.building = true;
    const { container, unmount } = renderPage();
    try {
      openSettingsSection(container, "export");
      const panel = container.querySelector("#bin-settings-export")!;
      expect(panel.textContent).toContain("82.4 cm³ model volume");
      expect(panel.textContent).toContain("Previous model · updating…");
    } finally { unmount(); }
  });

  it("keeps camera framing on the completed mesh while new dimensions build", async () => {
    binGeometryMock.building = true;
    binGeometryMock.progress = 0;
    binGeometryMock.builtSpec = parseBinSpec({
      gridX: 2,
      gridY: 2,
      heightUnits: 6,
    });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT,
      spec: parseBinSpec({ gridX: 4, gridY: 3, heightUnits: 8 }),
    });

    const { container, unmount } = renderPage();
    await flushHydration();

    expect(container.textContent).toContain("4 × 3 × 8u");
    const viewport = container.querySelector('[data-testid="bin-viewport-stub"]');
    expect(viewport?.getAttribute("data-fit-width")).toBe("83.5");
    expect(viewport?.getAttribute("data-fit-length")).toBe("83.5");
    expect(Number(viewport?.getAttribute("data-fit-height"))).toBeCloseTo(45.5515, 3);
    unmount();
  });

  it("makes the long settings panel scannable by purpose", () => {
    const { container, unmount } = renderPage();
    const index = container.querySelector('[data-testid="bin-settings-index"]');
    expect(index?.textContent).toContain("Find a setting");
    expect(index?.textContent).toContain("Pockets");
    expect(index?.textContent).not.toContain("Color by purpose");

    const expectedSections = [
      ["bin-settings-project", "slate", "closed"],
      ["bin-settings-size", "blue", "open"],
      ["bin-settings-construction", "rose", "closed"],
      ["bin-settings-pockets", "violet", "closed"],
      ["bin-settings-finger-holes", "cyan", "closed"],
      ["bin-settings-fit", "indigo", "closed"],
      ["bin-settings-export", "emerald", "closed"],
    ] as const;
    for (const [id, tone, state] of expectedSections) {
      const section = container.querySelector(`#${id}`);
      expect(section?.getAttribute("data-tone")).toBe(tone);
      expect(section?.getAttribute("data-state")).toBe(state);
    }
    const tones = [
      ...container.querySelectorAll<HTMLElement>('[id^="bin-settings-"]'),
    ].map((section) => section.dataset.tone);
    expect(tones.every(Boolean)).toBe(true);

    const construction = container.querySelector(
      "#bin-settings-construction",
    ) as HTMLElement;
    const scroller = construction.parentElement!;
    const scrollTo = vi.fn();
    vi.spyOn(construction, "getBoundingClientRect").mockReturnValue({
      top: 290,
    } as DOMRect);
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({
      top: 100,
    } as DOMRect);
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, value: 50, writable: true },
      scrollTo: { configurable: true, value: scrollTo },
    });
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });

    React.act(() => {
      (
        container.querySelector(
          '[data-testid="bin-settings-jump-construction"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(
      container
        .querySelector("#bin-settings-construction")
        ?.getAttribute("data-state"),
    ).toBe("open");
    expect(
      container.querySelector("#bin-settings-size")?.getAttribute("data-state"),
    ).toBe("closed");
    expect(scroller.style.paddingBottom).toBe("400px");
    expect(scrollTo).toHaveBeenCalledWith({ top: 240, behavior: "auto" });
    requestFrame.mockRestore();
    unmount();
  });

  it.each([false, true])("opens and focuses color controls from the legend with mobile=%s", async (mobile) => {
    let controls: ReturnType<typeof usePanelState>;
    function PanelProbe() { controls = usePanelState(); return null; }
    const { container, unmount } = render(
      <PanelProvider><PanelProbe /><ShapeLibraryProvider><BinDesignerPage /></ShapeLibraryProvider></PanelProvider>,
      { mobile },
    );
    await flushHydration();
    for (const target of ["bin", "pocket-floor", "stacking-rim", "bin"] as const) {
      React.act(() => controls.setPanelOpen(false));
      React.act(() => container.querySelector<HTMLButtonElement>(`[data-testid="legend-${target}"]`)!.click());
      expect(controls!.panelOpen).toBe(true);
      expect(document.querySelector('#bin-settings-materials')?.getAttribute('data-state')).toBe('open');
      await vi.waitFor(() => expect(document.activeElement?.id).toBe(`input-${target}-color`));
      // Returning from another section must also work for the same legend entry.
      openSettingsSection(document.body, "size");
      React.act(() => container.querySelector<HTMLButtonElement>(`[data-testid="legend-${target}"]`)!.click());
      expect(document.querySelector('#bin-settings-materials')?.getAttribute('data-state')).toBe('open');
      await vi.waitFor(() => expect(document.activeElement?.id).toBe(`input-${target}-color`));
    }
    unmount();
  });

  it("lets the user toggle pocket-floor coloring without rebuilding geometry", () => {
    binGeometryMock.hasPocketFloor = true;
    const { container, unmount } = renderPage();

    const viewport = container.querySelector('[data-testid="bin-viewport-stub"]');
    expect(viewport?.getAttribute("data-pocket-floor-color")).toBe("on");

    React.act(() => {
      (
        container.querySelector(
          '[data-testid="bin-settings-jump-materials-&-colors"]',
        ) as HTMLButtonElement
      ).click();
    });
    const toggle = container.querySelector(
      '[role="switch"][aria-label="Color pocket floors"]',
    ) as HTMLButtonElement;
    expect(toggle?.getAttribute("data-state")).toBe("checked");

    React.act(() => toggle.click());
    expect(viewport?.getAttribute("data-pocket-floor-color")).toBe("off");
    expect(toggle.getAttribute("data-state")).toBe("unchecked");
    unmount();
  });

  it.each([true, false])("sets the correct floor when selecting floor mode with flatBottom=%s", async (flatBottom) => {
    const shape = rectangularShape("tool", "Depth test");
    const spec = parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, flatBottom });
    const depthMm = resolvePocketDepth(spec, { mode: "remaining", floorThicknessMm: 7 }).depthMm!;
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, spec, shapes: [shape],
      cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 }, depth: { mode: "mm", value: depthMm } })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "tool-cutouts");
    selectPocket(container, "pocket");
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Pocket depth mode"]')!;
    React.act(() => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((node) => node.textContent?.includes("Keep floor thickness"))!;
    React.act(() => option.click());
    const floor = container.querySelector<HTMLInputElement>('input[aria-label="Remaining floor thickness in millimetres"]')!;
    expect(floor.value).toBe(flatBottom ? "2" : "7");
    unmount();
  });

  it.each(["standard", "workflow"])("opens a surface pocket fully through a finger groove in %s layout", async layout => {
    const url = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const shape = rectangularShape("tool", "Through rectangle");
    const spec = parseBinSpec({ gridX: 3, gridY: 1, heightUnits: 4, lip: "none", pegBottom: {} });
    const original = parseCutoutPlacement({ id: "through-groove", shapeId: shape.id, position: { x: 30, y: 0 },
      depth: { mode: "remaining", floorThicknessMm: 2 }, bottomFilletMm: 0 });
    const finger = fingerHoleSchema.parse({ id: "groove", kind: "oblong-deep-scoop", center: { x: 0, y: 0 }, lengthMm: 100, diameterMm: 18, depthMm: 12 });
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec, shapes: [shape], cutouts: [original], fingerHoles: [finger] });
    const { container, unmount } = renderPage();
    try {
      await flushHydration(); selectPocket(container, original.id);
      React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Pocket depth mode"]')!
        .dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
      React.act(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(node => node.textContent === "Through")!.click());
      const changed = vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[0];
      expect(changed.depth).toEqual({ mode: "through" });
      expect(changed.elevationMm).toBeUndefined(); expect(changed.zOffsetMm).toBeUndefined();
      expect(changed.position).toEqual(original.position);
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.fingerHoles).toEqual([finger]);
    } finally { unmount(); window.history.replaceState(null, "", url); }
  });

  it("keeps error details on the canvas in both views, collapses them, and blocks export", async () => {
    const shape = rectangularShape("tool", "Wrench");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, shapes: [shape],
      spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "solid" }),
      cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 70, y: 0 } })],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    const warnings = container.querySelector<HTMLElement>('[data-testid="canvas-warnings"]')!;
    expect(warnings.closest('[data-testid="bin-canvas"]')).not.toBeNull();
    const toggle = warnings.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    React.act(() => toggle.click());
    const issue = warnings.querySelector<HTMLButtonElement>('[data-issue-code="out-of-bounds"]')!;
    expect(issue).not.toBeNull();
    expect(container.querySelectorAll('[data-issue-code="out-of-bounds"]')).toHaveLength(1);
    expect(toggle.textContent).toContain('error');
    React.act(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(warnings.querySelector('[data-issue-code]')).toBeNull();
    React.act(() => toggle.click());
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    expect(container.querySelector('[data-testid="canvas-warnings"]')).toBe(warnings);
    React.act(() => warnings.querySelector<HTMLButtonElement>('[data-issue-code="out-of-bounds"]')!.click());
    expect(container.querySelector('[data-testid="pocket-properties-heading"]')!.textContent).toContain('Wrench');
    openSettingsSection(container, 'export');
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-export-stl"]')!.disabled).toBe(true);
    expect(container.querySelector('[data-testid="export-blocked-reasons"]')?.textContent).toContain("3D export");
    expect(container.querySelector('[data-export-issue="out-of-bounds"]')).not.toBeNull();
    unmount();
  });

  it.each(["standard", "workflow"])("cycles between overlapping pockets and allows export in both views (%s)", async layout => {
    localStorage.setItem("pocketry:editor-layout", layout);
    const first = rectangularShape('first', 'Wrench');
    const second = rectangularShape('second', 'Pliers');
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, shapes: [first, second],
      spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "solid" }),
      cutouts: [
        parseCutoutPlacement({ id: 'first-pocket', shapeId: first.id, position: { x: -3, y: 0 } }),
        parseCutoutPlacement({ id: 'second-pocket', shapeId: second.id, position: { x: 3, y: 0 } }),
      ],
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="canvas-warnings"] button[aria-expanded]')!.click());
    const issue = container.querySelector<HTMLButtonElement>('[data-testid="canvas-warnings"] [data-issue-code="cutout-overlap"]')!;
    React.act(() => issue.click());
    const firstName = container.querySelector('[data-testid="pocket-properties-heading"]')!.textContent;
    React.act(() => issue.click());
    expect(container.querySelector('[data-testid="pocket-properties-heading"]')!.textContent).not.toBe(firstName);
    expect(issue.getAttribute('data-selected')).toBe('true');
    expect(container.querySelector('[data-testid="layout-canvas"]')).not.toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
    for (const view of ["2d", "3d"]) {
      React.act(() => container.querySelector<HTMLButtonElement>(`[data-testid="view-toggle-${view}"]`)!.click());
      openSettingsSection(container, 'export');
      expect(container.querySelector<HTMLButtonElement>('[data-testid="button-export-stl"]')!.disabled).toBe(false);
      expect(container.querySelector<HTMLButtonElement>('[data-testid="button-export-3mf"]')!.disabled).toBe(false);
    }
    unmount();
  });

  it.each([false, true])("starts warnings as a compact count and expands the messages on request (mobile: %s)", async (mobile) => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT,
      spec: parseBinSpec({ gridX: 7, gridY: 2, heightUnits: 6 }),
    });
    const { container, unmount } = renderPage({ mobile });
    await flushHydration();
    const warnings = container.querySelector<HTMLElement>('[data-testid="canvas-warnings"]')!;
    const toggle = warnings.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toContain('Expand');
    expect(warnings.querySelector('[data-issue-code]')).toBeNull();
    React.act(() => toggle.click());
    expect(warnings.querySelector('[data-issue-code="large-footprint"]')).not.toBeNull();
    expect(toggle.getAttribute('aria-label')).toContain('Collapse');
    unmount();
  });

  it("shows live floor-color warnings only on the canvas, with a reminder at export", async () => {
    const shape = rectangularShape("tool", "Air Duster");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT,
      spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6.5, fill: "solid" }),
      shapes: [shape],
      cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 0, y: 0 }, depth: { mode: "mm", value: 39 } })],
    });
    binGeometryMock.hasPocketFloor = true;
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "export");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="canvas-warnings"] button[aria-expanded]')!.click());
    const issueSelector = '[data-issue-code="floor-color-on-underside"]';
    const issue = container.querySelector<HTMLButtonElement>(issueSelector)!;
    expect(issue.textContent).toContain("Air Duster");
    expect(issue.textContent).toContain("Floor color may show on the underside");
    React.act(() => issue.click());
    expect(container.querySelector('#bin-settings-materials')).not.toBeNull();
    expect(issue.textContent).toContain("Edit floor color thickness");
    expect(issue.closest('[data-testid="bin-canvas"]')).not.toBeNull();
    expect(container.querySelectorAll(issueSelector)).toHaveLength(1);
    expect(container.querySelector('[data-testid="selected-object-issues"]')).toBeNull();

    const setNumber = (input: HTMLInputElement, value: string) => React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    openSettingsSection(container, "tool-cutouts");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-select-pocket"]')!.click());
    const depthInput = container.querySelector<HTMLInputElement>('[aria-label="Pocket cut depth in millimetres"]')!;
    setNumber(depthInput, "38.8");
    expect(container.querySelector(issueSelector)).toBeNull();
    setNumber(depthInput, "39");
    expect(container.querySelector(issueSelector)).not.toBeNull();

    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="bin-settings-jump-materials-&-colors"]')!.click());
    expect(container.querySelector('[aria-label="Pocket floor color warnings"]')).toBeNull();
    expect(container.querySelector('[data-testid="canvas-warnings"]')!.textContent).toContain("Air Duster");
    const thicknessInput = container.querySelector<HTMLInputElement>('[data-testid="input-pocket-floor-thickness"]')!;
    setNumber(thicknessInput, "0.4");
    expect(container.querySelector(issueSelector)).toBeNull();
    setNumber(thicknessInput, "0.6");
    expect(container.querySelector(issueSelector)).not.toBeNull();
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Color pocket floors"]')!;
    React.act(() => toggle.click());
    expect(container.querySelector(issueSelector)).toBeNull();
    React.act(() => toggle.click());
    expect(container.querySelector(issueSelector)).not.toBeNull();

    openSettingsSection(container, "export");
    const exportButton = container.querySelector<HTMLButtonElement>('[data-testid="button-export-3mf"]')!;
    expect(exportButton.disabled).toBe(false);
    React.act(() => exportButton.click());
    expect(document.querySelector('[data-testid="export-floor-color-warning"]')!.textContent).toContain("Floor color may show on the underside");
    expect(document.querySelector<HTMLButtonElement>('[data-testid="button-export-multicolor-3mf"]')!.disabled).toBe(false);
    unmount();
  });

  it.each(["standard", "workflow"])("copies exact colors between every feature in the %s layout", async layout => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const { container, unmount } = renderPage();
    const features = [
      { id: "bin", label: "Bin body", color: "#123456" },
      { id: "pocket-floor", label: "Pocket floors", color: "#abcdef" },
      { id: "stacking-rim", label: "Stacking rim top", color: "#654321" },
      { id: "text", label: "Text", color: "#fedcba" },
    ];
    const input = (id: string) => container.querySelector<HTMLInputElement>(`#input-${id}-color`)!;
    const setColor = (id: string, color: string) => React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(id), color);
      input(id).dispatchEvent(new Event("input", { bubbles: true }));
    });
    try {
      await flushHydration();
      openSettingsSection(container, "materials");
      for (const target of features) for (const source of features.filter(source => source.id !== target.id)) {
        features.forEach(feature => setColor(feature.id, feature.color));
        await React.act(async () => container.querySelector(`[data-testid="input-${target.id}-color-copy-from"]`)!
          .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
        const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
        expect(items).toHaveLength(3);
        const item = items.find(item => item.textContent!.startsWith(source.label))!;
        expect(item.textContent).toContain(source.color.toUpperCase());
        await React.act(async () => item.click());
        expect(input(target.id).value).toBe(source.color);
        setColor(source.id, "#001122");
        expect(input(target.id).value).toBe(source.color);
      }
      React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Color pocket floors"]')!.click());
      expect(container.querySelector<HTMLButtonElement>('[data-testid="input-pocket-floor-color-copy-from"]')!.disabled).toBe(true);
    } finally {
      unmount();
      window.history.replaceState(null, "", originalUrl);
    }
  });

  it.each([
    { colorCoverage: "interior" as const },
    { colorFloorAxis: "x" as const },
  ])("exports selected wall coloring on a through pocket: %j", async color => {
    const shape = rectangularShape("tool", "Through tool");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, shapes: [shape],
      cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id,
        position: { x: 0, y: 0 }, depth: { mode: "through" }, ...color })],
      materials: { ...DEFAULT_BIN_MATERIALS, colorStackingRim: false },
    });
    const mesh = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]), normals: null };
    binGeometryMock.hasPocketFloor = true;
    binGeometryMock.buildOnce.mockResolvedValue({ mesh, materialMeshes: { body: mesh, pocketFloors: mesh } });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "export");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-export-3mf"]')!.click());
      const exportButton = document.querySelector<HTMLButtonElement>('[data-testid="button-export-multicolor-3mf"]')!;
      expect(exportButton.disabled).toBe(false);
      await React.act(async () => exportButton.click());
      expect(binGeometryMock.buildOnce).toHaveBeenLastCalledWith(expect.any(Object), expect.objectContaining({
        pocketFloorMaterialThicknessMm: DEFAULT_BIN_MATERIALS.pocketFloorThicknessMm,
      }));
      expect(downloadBlob).toHaveBeenCalledOnce();
      const blob = vi.mocked(downloadBlob).mock.calls[0][0];
      const buffer = await new Promise<ArrayBuffer>(resolve => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.readAsArrayBuffer(blob);
      });
      const xml = strFromU8(unzipSync(new Uint8Array(buffer))["3D/3dmodel.model"]);
      expect(xml).toContain("pocket " + ("colorCoverage" in color ? "interiors" : "floors"));
      expect(xml.match(/<mesh>/g)).toHaveLength(2);
    } finally { unmount(); }
  });

  it("shows compact color swatches and configurable material thickness", () => {
    binGeometryMock.hasPocketFloor = true;
    const { container, unmount } = renderPage();
    React.act(() => {
      (
        container.querySelector(
          '[data-testid="bin-settings-jump-materials-&-colors"]',
        ) as HTMLButtonElement
      ).click();
    });

    const body = container.querySelector(
      '[data-testid="input-bin-color"]',
    ) as HTMLInputElement;
    const floor = container.querySelector(
      '[data-testid="input-pocket-floor-color"]',
    ) as HTMLInputElement;
    const rim = container.querySelector(
      '[data-testid="input-stacking-rim-color"]',
    ) as HTMLInputElement;
    expect(body.value).toBe("#bfbfbf");
    expect(floor.value).toBe("#000000");
    expect(rim.value).toBe(floor.value);
    expect(container.textContent).not.toContain("#BFBFBF");
    expect(container.textContent).not.toContain("#000000");
    expect(
      container.querySelector('[data-testid="view-color-row-bin"]')?.contains(body),
    ).toBe(true);
    expect(
      container.querySelector('[data-testid="view-color-row-floor"]')?.contains(floor),
    ).toBe(true);
    expect(
      container.querySelector('[data-testid="view-color-row-rim"]')?.contains(rim),
    ).toBe(true);
    const floorThickness = container.querySelector(
      '[data-testid="input-pocket-floor-thickness"]',
    ) as HTMLInputElement;
    const rimThickness = container.querySelector(
      '[data-testid="input-stacking-rim-thickness"]',
    ) as HTMLInputElement;
    expect(floorThickness.value).toBe("0.6");
    expect(rimThickness.value).toBe("1.25");
    expect(floorThickness.max).toBe("3");
    expect(rimThickness.max).toBe("7.35");
    expect(container.textContent).toContain("mm down");
    expect(container.textContent).not.toContain("never adds height to the bin");
    const thicknessHelp = container.querySelector<HTMLButtonElement>('[data-testid="view-color-row-floor"] [aria-label="About color thickness"]')!;
    React.act(() => thicknessHelp.click());
    expect(document.querySelector('[role="tooltip"]')!.textContent).toContain("never changes pocket dimensions");
    React.act(() => thicknessHelp.click());

    React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        body,
        "#112233",
      );
      body.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        floor,
        "#445566",
      );
      floor.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        rim,
        "#778899",
      );
      rim.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        floorThickness,
        "1.2",
      );
      floorThickness.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        rimThickness,
        "1.4",
      );
      rimThickness.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const viewport = container.querySelector('[data-testid="bin-viewport-stub"]');
    expect(viewport?.getAttribute("data-bin-color")).toBe("#112233");
    expect(viewport?.getAttribute("data-floor-color")).toBe("#445566");
    expect(viewport?.getAttribute("data-rim-color")).toBe("#778899");
    expect(viewport?.getAttribute("data-stacking-rim-color")).toBe("on");
    expect(floorThickness.value).toBe("1.2");
    expect(rimThickness.value).toBe("1.4");
    unmount();
  });

  it.each(["standard", "workflow"])("edits and exports a top border without a lip in the %s layout", async layout => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, spec: { ...EMPTY_PROJECT.spec, lip: "none" },
    });
    const mesh = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]), normals: null };
    binGeometryMock.buildOnce.mockResolvedValue({ mesh, materialMeshes: { body: mesh, stackingRim: mesh } });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "materials");
      const color = container.querySelector<HTMLInputElement>('[data-testid="input-stacking-rim-color"]')!;
      const depth = container.querySelector<HTMLInputElement>('[data-testid="input-stacking-rim-thickness"]')!;
      const width = container.querySelector<HTMLInputElement>('[data-testid="input-border-width"]')!;
      const toggle = container.querySelector<HTMLButtonElement>('[aria-label="Color top border"]')!;
      expect(color.disabled).toBe(false);
      expect(depth.disabled).toBe(false);
      expect(width.disabled).toBe(false);
      expect(width.value).toBe("0.95");
      expect(toggle.getAttribute("aria-checked")).toBe("true");
      const setValue = (input: HTMLInputElement, value: string) => React.act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      setValue(color, "#778899");
      setValue(depth, "2.5");
      setValue(width, "4");
      expect(vi.mocked(useBinGeometry).mock.lastCall![4]?.stackingRimThicknessMm).toBe(2.5);
      expect(vi.mocked(useBinGeometry).mock.lastCall![4]?.borderWidthMm).toBe(4);
      React.act(() => toggle.click());
      expect(color.disabled).toBe(true);
      expect(depth.disabled).toBe(true);
      expect(width.disabled).toBe(true);
      expect(container.querySelector('[data-testid="bin-viewport-stub"]')?.getAttribute("data-stacking-rim-color")).toBe("off");
      openSettingsSection(container, "export");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-export-3mf"]')!.click());
      expect(document.querySelector<HTMLButtonElement>('[data-testid="button-export-multicolor-3mf"]')!.disabled).toBe(true);
      React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === "Cancel")!.click());
      openSettingsSection(container, "materials");
      React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Color top border"]')!.click());

      // Construction undo restores the flush border and preserves material settings.
      openSettingsSection(container, "construction");
      React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Stacking lip"]')!.click());
      openSettingsSection(container, "materials");
      expect(container.querySelector('[aria-label="Color stacking rim top"]')?.getAttribute("aria-checked")).toBe("true");
      expect(container.querySelector('[data-testid="input-border-width"]')).toBeNull();
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].lip).toBe("none");
      expect(container.querySelector('[aria-label="Color top border"]')?.getAttribute("aria-checked")).toBe("true");
      expect(container.querySelector<HTMLInputElement>('[data-testid="input-stacking-rim-color"]')!.value).toBe("#778899");
      expect(container.querySelector<HTMLInputElement>('[data-testid="input-stacking-rim-thickness"]')!.value).toBe("2.5");
      expect(container.querySelector<HTMLInputElement>('[data-testid="input-border-width"]')!.value).toBe("4");
      expect(container.querySelector('[data-testid="bin-viewport-stub"]')?.getAttribute("data-stacking-rim-color")).toBe("on");

      openSettingsSection(container, "export");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-export-3mf"]')!.click());
      expect(document.body.textContent).toContain("Separate top border (4 mm wide, 2.5 mm down) for slicer assignment.");
      await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-export-multicolor-3mf"]')!.click());
      expect(binGeometryMock.buildOnce).toHaveBeenLastCalledWith(expect.any(Object), {
        pocketFloorMaterialThicknessMm: undefined, stackingRimMaterialThicknessMm: 2.5, borderWidthMm: 4,
      });
      expect(downloadBlob).toHaveBeenCalledTimes(1);
      const blob = vi.mocked(downloadBlob).mock.calls[0][0];
      const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = reject;
        reader.readAsArrayBuffer(blob);
      });
      const model = strFromU8(unzipSync(new Uint8Array(buffer))["3D/3dmodel.model"]);
      expect(model).toContain('<m:color color="#778899FF"/>');
      expect(model).toContain('name="Gridfinity bin 2x2x6 top border" pid="1" pindex="1"');
      expect(model).not.toContain("Stacking rim top");
    } finally {
      unmount();
      window.history.replaceState(null, "", originalUrl);
    }
  });

  it.each(["standard", "workflow"])("uses pocket-floor settings for a hollow bin and exports its floor in the %s layout", async layout => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, spec: { ...EMPTY_PROJECT.spec, fill: "none", lip: "none" },
    });
    binGeometryMock.hasPocketFloor = true;
    const mesh = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]), normals: null };
    binGeometryMock.buildOnce.mockResolvedValue({ mesh, materialMeshes: { body: mesh, pocketFloors: mesh } });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "materials");
      React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Color top border"]')!.click());
      const color = container.querySelector<HTMLInputElement>('[aria-label="Bin floor color"]')!;
      const depth = container.querySelector<HTMLInputElement>('[aria-label="Bin floor color thickness in millimetres"]')!;
      const toggle = container.querySelector<HTMLButtonElement>('[aria-label="Color bin floor"]')!;
      const setValue = (input: HTMLInputElement, value: string) => React.act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      setValue(color, "#2255aa");
      setValue(depth, "1.2");
      expect(vi.mocked(useBinGeometry).mock.lastCall![4]?.pocketFloorThicknessMm).toBe(1.2);
      const viewport = container.querySelector('[data-testid="bin-viewport-stub"]')!;
      expect(viewport.getAttribute("data-floor-color")).toBe("#2255aa");
      expect(viewport.getAttribute("data-floor-label")).toBe("Bin floor");
      expect(viewport.getAttribute("data-pocket-floor-color")).toBe("on");
      React.act(() => toggle.click());
      expect(color.disabled).toBe(true);
      expect(depth.disabled).toBe(true);
      expect(viewport.getAttribute("data-pocket-floor-color")).toBe("off");
      openSettingsSection(container, "export");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-export-3mf"]')!.click());
      expect(document.querySelector<HTMLButtonElement>('[data-testid="button-export-multicolor-3mf"]')!.disabled).toBe(true);
      React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === "Cancel")!.click());
      openSettingsSection(container, "materials");
      React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Color bin floor"]')!.click());

      openSettingsSection(container, "construction");
      React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Solid fill"]')!.click());
      openSettingsSection(container, "materials");
      expect(container.querySelector<HTMLInputElement>('[aria-label="Pocket floors color"]')!.value).toBe("#2255aa");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].fill).toBe("none");
      expect(container.querySelector<HTMLInputElement>('[aria-label="Bin floor color"]')!.value).toBe("#2255aa");
      expect(container.querySelector<HTMLInputElement>('[aria-label="Bin floor color thickness in millimetres"]')!.value).toBe("1.2");

      openSettingsSection(container, "export");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-export-3mf"]')!.click());
      expect(document.body.textContent).toContain("Separate bin floor (1.2 mm thick) for slicer assignment.");
      await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-export-multicolor-3mf"]')!.click());
      expect(binGeometryMock.buildOnce).toHaveBeenLastCalledWith(expect.any(Object), {
        pocketFloorMaterialThicknessMm: 1.2, stackingRimMaterialThicknessMm: undefined, borderWidthMm: undefined,
      });
      expect(downloadBlob).toHaveBeenCalledTimes(1);
      const blob = vi.mocked(downloadBlob).mock.calls[0][0];
      const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = reject;
        reader.readAsArrayBuffer(blob);
      });
      const model = strFromU8(unzipSync(new Uint8Array(buffer))["3D/3dmodel.model"]);
      expect(model).toContain('<m:color color="#2255AAFF"/>');
      expect(model).toContain('name="Gridfinity bin 2x2x6 bin floor" pid="1" pindex="1"');
    } finally {
      unmount();
      window.history.replaceState(null, "", originalUrl);
    }
  });

  it("exports the border color when a wide border leaves no body material", async () => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT,
      spec: parseBinSpec({ gridX: 1, gridY: 1, gridPitch: "quarter", heightUnits: 1, lip: "none", flatBottom: true }),
    });
    const mesh = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]), normals: null };
    const empty = { positions: new Float32Array(), indices: new Uint32Array(), normals: null };
    binGeometryMock.buildOnce.mockResolvedValue({ mesh, materialMeshes: { body: empty, stackingRim: mesh } });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      openSettingsSection(container, "export");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-export-3mf"]')!.click());
      await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-export-multicolor-3mf"]')!.click());
      expect(downloadBlob).toHaveBeenCalledTimes(1);
      expect(projectToast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
    } finally { unmount(); }
  });});
