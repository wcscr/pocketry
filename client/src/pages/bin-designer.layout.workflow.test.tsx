import {
  projectToast,
  EMPTY_PROJECT,
  rectangularShape,
  flushHydration,
  BinDesignerPage,
  experimentalSettings,
  render,
  renderPage,
  openSettingsSection,
  openMobileProperties,
  toolButton,
  binHistoryButton,
  clickBinHistory,
  selectPocket,
} from "./bin-designer.test-support";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { EXPERIMENTAL_FEATURES_KEY } from "@/state/experimental-features";
import { PanelProvider, usePanelState } from "@/components/layout/panel-context";
import * as ShapeLibraryModule from "@/state/shape-library";
import { ShapeLibraryProvider } from "@/state/shape-library";
import { parseProjectDoc, type ProjectDoc } from "@shared/gridfinity/project";
import { fingerHoleSchema, parseCutoutPlacement } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { downloadBlob } from "@/lib/download";
import { useBinGeometry } from "@/lib/gridfinity/use-bin-geometry";
import { createBasicPocket } from "@/lib/gridfinity/basic-shape";
import { fitLayoutToPlacements } from "@/lib/gridfinity/autoplace";
import { validateBinSpec, validateLayout } from "@shared/gridfinity/validate";
import * as ProjectPersistence from "@/lib/project/persist";

describe("BinDesignerPage", () => {

  it.each([
    { layout: "standard", mobile: false },
    { layout: "workflow", mobile: false },
    { layout: "standard", mobile: true },
  ])("compacts repeated photo additions from the canvas warning with one selected pocket: $layout, mobile=$mobile", async ({layout, mobile}) => {
    localStorage.setItem("pocketry:editor-layout", layout);
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      spec: parseBinSpec({gridX:2,gridY:2,heightUnits:6,fill:"solid",lip:"none"}) });
    let library!: ShapeLibraryModule.ShapeLibrary;
    let panels!: ReturnType<typeof usePanelState>;
    function Arrivals() { library = ShapeLibraryModule.useShapeLibrary(); panels = usePanelState(); return null; }
    const {container, unmount} = render(<PanelProvider><ShapeLibraryProvider><Arrivals /><BinDesignerPage /></ShapeLibraryProvider></PanelProvider>, {mobile});
    try {
      await flushHydration();
      // Four separate photo handoffs with five differently sized tools. These
      // synthetic outlines reproduce sparse growth without private photo data.
      const sizes = [[160,45],[190,30],[65,20],[55,18],[240,75]];
      const shapes = sizes.map(([width,height], i) => createBasicPocket("rectangle", {x:-width/2,y:-height/2}, {x:width/2,y:height/2}, `photo-tool-${i}`)!.shape);
      for (const batch of [[0],[1],[2,3],[4]]) {
        React.act(() => batch.forEach((i, offset) => library.addShape(shapes[i], {mode:"mm",value:12+i}, undefined,
          {batchId:`photo-${batch[0]}`,center:{x:offset*200,y:0}})));
        await flushHydration();
      }
      const current = () => vi.mocked(useBinGeometry).mock.lastCall!;
      const beforeSpec = current()[0], beforePockets = current()[2]!.cutouts;
      expect(beforePockets).toHaveLength(5);
      expect(validateBinSpec(beforeSpec).issues.some(issue => issue.code === "large-footprint")).toBe(true);
      const byId = new Map(shapes.map(shape => [shape.id,shape]));
      const fitted = fitLayoutToPlacements(beforePockets, byId, beforeSpec.lip, beforeSpec.gridPitch, [], beforeSpec);
      expect(validateBinSpec({...beforeSpec,gridX:fitted.gridX,gridY:fitted.gridY}).issues.some(issue => issue.code === "large-footprint")).toBe(true);
      selectPocket(container, beforePockets[0].id);
      React.act(() => panels.setPanelOpen(false));
      const warnings = container.querySelector<HTMLElement>('[data-testid="canvas-warnings"]')!;
      React.act(() => warnings.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
      expect(current()[2]!.cutouts).toEqual(beforePockets);
      const arrange = warnings.querySelector<HTMLButtonElement>('[data-testid="button-warning-auto-arrange"]')!;
      expect(arrange.disabled).toBe(false);
      expect(arrange.closest('[data-testid="bin-canvas"]')).not.toBeNull();
      React.act(() => arrange.click());
      const afterSpec = current()[0], afterPockets = current()[2]!.cutouts;
      expect(afterSpec.gridX*afterSpec.gridY).toBeLessThan(fitted.gridX*fitted.gridY);
      expect(validateBinSpec(afterSpec).issues.some(issue => issue.code === "large-footprint")).toBe(false);
      expect(validateLayout(afterSpec, afterPockets, byId).filter(issue => issue.severity === "error")).toEqual([]);
      expect(afterSpec.heightUnits).toBe(beforeSpec.heightUnits);
      expect(afterPockets).toHaveLength(5);
      for (const pocket of afterPockets) {
        const original = beforePockets.find(p => p.id === pocket.id)!;
        expect({...pocket,position:original.position,rotationDeg:original.rotationDeg}).toEqual(original);
      }
      expect(container.querySelector('[data-testid="button-warning-auto-arrange"]')).toBeNull();
      clickBinHistory(container, "undo");
      expect(current()[0]).toEqual(beforeSpec);
      expect(current()[2]!.cutouts).toEqual(beforePockets);
      clickBinHistory(container, "redo");
      expect(current()[0]).toEqual(afterSpec);
      expect(current()[2]!.cutouts).toEqual(afterPockets);
    } finally { unmount(); }
  });

  it.each([false,true])("keeps fixed dimensions when arranging from the warning, arbitrary=%s", async arbitrary => {
    const shapes = [rectangularShape("first","First"), rectangularShape("second","Second")];
    const spec = parseBinSpec({...EMPTY_PROJECT.spec,gridX:8,gridY:2,flatBottom:arbitrary,
      ...(arbitrary ? {arbitrarySizeMm:{width:330,length:80}} : {})});
    const cutouts = shapes.map((shape,i) => parseCutoutPlacement({id:`pocket-${i}`,shapeId:shape.id,position:{x:i*100-50,y:0},depth:{mode:"mm",value:12+i}}));
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({...EMPTY_PROJECT,spec,shapes,cutouts,keepBinSize:!arbitrary});
    const {container,unmount} = renderPage();
    try {
      await flushHydration();
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="canvas-warnings"] button[aria-expanded]')!.click());
      expect(container.querySelector('[data-testid="compact-layout-action"]')!.textContent).toContain("within the fixed bin size");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-warning-auto-arrange"]')!.click());
      const current = vi.mocked(useBinGeometry).mock.lastCall!;
      expect(current[0]).toEqual(spec);
      expect(current[2]!.cutouts.map(p => p.depth)).toEqual(cutouts.map(p => p.depth));
      expect(current[2]!.cutouts.map(p => p.position)).not.toEqual(cutouts.map(p => p.position));
    } finally { unmount(); }
  });

  it("closes the mobile controls when starting a geometric pocket from the panel", async () => {
    let controls: ReturnType<typeof usePanelState>;
    function PanelProbe() { controls = usePanelState(); return null; }
    const { container, unmount } = render(
      <PanelProvider><PanelProbe /><ShapeLibraryProvider><BinDesignerPage /></ShapeLibraryProvider></PanelProvider>, { mobile: true },
    );
    await flushHydration();
    try {
      React.act(() => controls.setPanelOpen(true));
      openSettingsSection(document.body, "tool-cutouts");
      const add = document.querySelector<HTMLButtonElement>('#bin-settings-pockets button[aria-haspopup="menu"]')!;
      React.act(() => add.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      React.act(() => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === "Circle")!.click());
      const dimensions = [...document.querySelectorAll('[role="dialog"]')].find(dialog => dialog.textContent?.includes("Add circle pocket"))!;
      expect(dimensions.textContent).toContain("Add circle pocket");
      React.act(() => [...dimensions.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "Draw on canvas")!.click());
      expect(controls!.panelOpen).toBe(false);
      expect(container.querySelector('[data-testid="layout-canvas"]')).not.toBeNull();
      expect(container.textContent).toContain("Drag from the centre to the edge of the circle");
    } finally { unmount(); }
  });

  it.each(["Rectangle", "Square", "Circle"])("draws a %s as a pocket without a photo or bin growth, with one undo step", async kind => {
    const { container, unmount } = renderPage();
    await flushHydration();
    try {
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
      const pan = toolButton(container, "Pan layout");
    React.act(() => pan.click());
      const add = container.querySelector<HTMLButtonElement>('[data-testid="toolbar-add-object"]')!;
      React.act(() => add.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      React.act(() => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === `${kind} pocket`)!.click());
      expect(container.querySelector('[aria-label="Pan layout"]')!.getAttribute("aria-pressed")).toBe("false");
      const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
      // A zoomed/panned scene: client -> model coordinates must use the SVG transform.
      Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
      Object.defineProperties(svg, {
        createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: (this.x - 10) / 2, y: (this.y - 20) / 2 }; } }) },
        setPointerCapture: { value: () => {} },
      });
      const pointer = (type: string, x: number, y: number) => React.act(() => {
        const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
        Object.defineProperty(event, "pointerId", { value: 1 });
        svg.dispatchEvent(event);
      });
      pointer("pointerdown", 73.5, 83.5);
      pointer("pointermove", 113.5, 103.5);
      expect(container.querySelector('[data-testid="basic-pocket-draft"]')).not.toBeNull();
      pointer("pointerup", 113.5, 103.5);
      expect(container.querySelector('[data-testid="basic-pocket-draft"]')).toBeNull();
      expect(container.textContent).toContain(`${kind} pocket`);
      const layout = vi.mocked(useBinGeometry).mock.lastCall![2]!;
      expect(layout.cutouts).toHaveLength(1);
      expect(layout.fingerHoles).toEqual([]);
      const shape = layout.shapes.find(shape => shape.id === layout.cutouts[0].shapeId)!;
      expect(shape.source).toBe("basic-shape");
      expect(shape.sourceMmPerPx).toBeNull();
      expect(shape.bboxMm.maxX - shape.bboxMm.minX).toBeCloseTo(kind === "Circle" ? Math.hypot(20, 10) * 2 : 20);
      expect(shape.bboxMm.maxY - shape.bboxMm.minY).toBeCloseTo(kind === "Circle" ? Math.hypot(20, 10) * 2 : kind === "Square" ? 20 : 10);
      expect(vi.mocked(useBinGeometry).mock.lastCall![0]).toEqual(EMPTY_PROJECT.spec);
      expect(container.textContent).not.toContain("was traced without a scale");
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual([]);
      expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
      clickBinHistory(container, "redo");
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual(layout.cutouts);
    } finally { unmount(); }
  });

  it.each(["Escape", "pointercancel", "tap", "mode change"])("discards a shape draft on %s without changing the library or history", async cancellation => {
    const { container, unmount } = renderPage();
    await flushHydration();
    try {
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
      const add = container.querySelector<HTMLButtonElement>('[data-testid="toolbar-add-object"]')!;
      React.act(() => add.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      React.act(() => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === "Rectangle pocket")!.click());
      const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
      Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
      Object.defineProperties(svg, {
        createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) },
        setPointerCapture: { value: () => {} },
      });
      const pointer = (type: string, x: number) => React.act(() => svg.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: x })));
      pointer("pointerdown", 30);
      if (cancellation === "tap") pointer("pointerup", 31);
      else {
        pointer("pointermove", 50);
        if (cancellation === "Escape") React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
        else if (cancellation === "mode change") React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-3d"]')!.click());
        else pointer("pointercancel", 50);
      }
      expect(container.querySelector('[data-testid="basic-pocket-draft"]')).toBeNull();
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual([]);
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.shapes).toEqual([]);
      expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
    } finally { unmount(); }
  });

  it("auto-places an arriving shape and shows it in Pockets and the Layout view", async () => {
    // A live handle on the library so a shape can arrive *after* mount, the
    // way the trace workspace hands one over.
    let libraryHandle: import("@/state/shape-library").ShapeLibrary | null = null;
    function LibraryProbe() {
      libraryHandle = ShapeLibraryModule.useShapeLibrary();
      return null;
    }

    const { container, unmount } = render(
      <PanelProvider>
        <ShapeLibraryProvider>
          <LibraryProbe />
          <BinDesignerPage />
        </ShapeLibraryProvider>
      </PanelProvider>,
    );
    await flushHydration();

    React.act(() =>
      libraryHandle!.addShape({
        id: "shape-1",
        name: "test wrench",
        outlineMm: [
          {
            outer: [
              { x: -20, y: -8 },
              { x: 20, y: -8 },
              { x: 20, y: 8 },
              { x: -20, y: 8 },
            ],
            holes: [],
          },
        ],
        bboxMm: { minX: -20, minY: -8, maxX: 20, maxY: 8 },
        pointCount: 4,
        sourceMmPerPx: 0.5,
      }),
    );

    const text = container.textContent ?? "";
    expect(text).toContain("test wrench");
    expect(container.querySelector('[aria-label="Choose a pocket to edit"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Selected pocket properties"]')).not.toBeNull();
    // Selected-pocket controls appear for the auto-selected cutout.
    expect(text).not.toContain("Editing selected tool");
    expect(text).toContain("Rotation");
    expect(text).toContain("Scale");
    const widthScale = container.querySelector(
      '[data-testid="input-pocket-scale-x"]',
    ) as HTMLInputElement;
    const heightScale = container.querySelector(
      '[data-testid="input-pocket-scale-y"]',
    ) as HTMLInputElement;
    expect(widthScale.value).toBe("100");
    expect(heightScale.value).toBe("100");
    const aspectLock = container.querySelector(
      '[aria-label="Unlock pocket aspect ratio"]',
    ) as HTMLButtonElement;
    expect(aspectLock).not.toBeNull();
    React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        widthScale,
        "150",
      );
      widthScale.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(widthScale.value).toBe("150");
    expect(heightScale.value).toBe("150");
    React.act(() => aspectLock.click());
    expect(
      container.querySelector('[aria-label="Lock pocket aspect ratio"]'),
    ).not.toBeNull();
    React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        heightScale,
        "80",
      );
      heightScale.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(widthScale.value).toBe("150");
    expect(heightScale.value).toBe("80");
    React.act(() => {
      ([...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Reset 100%",
      ) as HTMLButtonElement).click();
    });
    expect(widthScale.value).toBe("100");
    expect(heightScale.value).toBe("100");
    expect(text).toContain("Extra pocket clearance");
    expect(text).not.toContain("Added after the Trace margin");
    expect(container.querySelector('[aria-label="About extra pocket clearance"]')).not.toBeNull();
    expect(text).toContain("Outline corner rounding");
    expect(text).toContain("Top edge rounding");
    expect(text).toContain("Bottom edge fillet");
    expect(text).toContain("Finger access");
    const pocketTopRound = container.querySelector(
      '#pocket-properties [aria-label="Top edge rounding"] [role="slider"]',
    );
    expect([...container.querySelectorAll('[data-testid="pocket-edge-settings"] input')].map((input) => input.getAttribute('aria-label'))).toEqual([
      'Top edge rounding in millimetres', 'Bottom edge fillet in millimetres', 'Outline corner rounding in millimetres',
    ]);
    expect(pocketTopRound?.getAttribute("aria-valuemax")).toBe("5");
    expect(pocketTopRound?.getAttribute("aria-valuenow")).toBe("1");
    const renameButton = container.querySelector(
      '[data-testid^="button-rename-"]',
    ) as HTMLButtonElement;
    expect(renameButton.closest('[data-testid^="cutout-row-"]')).not.toBeNull();
    expect(container.querySelector('[data-testid^="button-select-"][aria-pressed="true"]')!.textContent).toContain("test wrench");
    React.act(() => renameButton.click());
    const shapeName = container.querySelector(
      '[data-testid="input-shape-name"]',
    ) as HTMLInputElement;
    React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        shapeName,
        "Bench wrench",
      );
      shapeName.dispatchEvent(new Event("input", { bubbles: true }));
    });
    React.act(() => {
      shapeName.blur();
    });
    expect(libraryHandle!.shapes.find((shape) => shape.id === "shape-1")?.name).toBe(
      "test wrench",
    );
    expect(container.textContent).toContain("Bench wrench");

    openSettingsSection(container, "export");
    const exportSection = container.querySelector("#bin-settings-export")!;
    expect(exportSection.querySelector("[data-panel-section-trigger]")?.textContent)
      .toMatch(/^Export/);
    expect(exportSection.textContent).toContain("Export shadow-board layout (top view)");
    expect(exportSection.querySelector('[data-testid="button-layout-dxf"]')).not.toBeNull();
    expect(exportSection.querySelector('[data-testid="button-layout-svg"]')).not.toBeNull();
    openSettingsSection(container, "check-fit");
    const fitSection = container.querySelector("#bin-settings-fit")!;
    expect(fitSection.textContent).toContain("Prepare fit test templates");
    expect(fitSection.querySelector('[data-testid="button-layout-dxf"]')).toBeNull();
    expect(fitSection.querySelector('[data-testid="button-layout-svg"]')).toBeNull();
    expect(fitSection.querySelector('[aria-label="About surface fit test"]')).toBeNull();
    expect(container.querySelector('[data-testid="select-surface-fit-test-style"]')?.textContent).toBe("Tool outlines · 5 mm");
    expect(container.textContent).toContain("Save surface fit test STL");
    expect(
      (
        container.querySelector(
          '[data-testid="input-surface-fit-test-thickness"]',
        ) as HTMLInputElement
      ).value,
    ).toBe("0.8");
    expect(
      (
        container.querySelector(
          '[data-testid="button-export-surface-fit-test"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(container.textContent).toContain("Tool fit template");
    expect(container.textContent).toContain("Save fit template STL");
    openSettingsSection(container, "export");
    React.act(() => {
      (
        container.querySelector(
          '[data-testid="button-export-3mf"]',
        ) as HTMLButtonElement
      ).click();
    });
    const multicolorExport = document.querySelector(
      '[data-testid="button-export-multicolor-3mf"]',
    ) as HTMLButtonElement;
    expect(multicolorExport).not.toBeNull();
    expect(multicolorExport.disabled).toBe(false);
    expect(document.body.textContent).toContain(
      "Separate pocket floors (0.6 mm thick) and rim top (1.25 mm down) for slicer assignment.",
    );
    const exportDialog = document.querySelector('[role="dialog"]') as HTMLElement;
    React.act(() => {
      (
        [...exportDialog.querySelectorAll("button")].find(
          (button) => button.textContent === "Cancel",
        ) as HTMLButtonElement
      ).click();
    });

    // Finger access features live in their own object list and selection context.
    openSettingsSection(container, "finger-holes");
    const addFingerHole = container.querySelector(
      '[data-testid="button-add-finger-hole"]',
    ) as HTMLButtonElement;
    React.act(() => addFingerHole.click());
    expect(container.querySelector('[data-testid="finger-shape-slot"]')?.getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector('[data-testid="finger-bottom-curved"]')?.getAttribute("aria-checked")).toBe("true");
    expect(container.textContent).not.toContain("Scoop depth");
    const fingerHoleSection = container.querySelector(
      '#bin-settings-finger-holes',
    );
    expect(
      fingerHoleSection?.querySelector('[aria-label="Top edge round"]'),
    ).not.toBeNull();
    const fingerTopRoundSlider = fingerHoleSection?.querySelector(
      '[aria-label="Top edge round"] [role="slider"]',
    );
    expect(fingerTopRoundSlider?.getAttribute("aria-valuemax")).toBe("5");
    expect(fingerTopRoundSlider?.getAttribute("aria-valuenow")).toBe("1");
    expect(
      fingerHoleSection?.querySelector('[aria-label="Bottom edge round"]'),
    ).toBeNull();

    React.act(() => {
      (container.querySelector('[data-testid="view-toggle-2d"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid^="finger-hole-oblong-deep-scoop-"]')).not.toBeNull();
    expect(container.querySelector('[data-testid^="finger-hole-width-"]')).not.toBeNull();

    // Selecting the pocket again is independent and exposes contour editing.
    openSettingsSection(container, "tool-cutouts");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid^="button-select-"]')!.click());
    expect(
      container.querySelectorAll('[data-testid^="pocket-resize-handle-"]'),
    ).toHaveLength(8);
    expect(
      (
        container.querySelector(
          '[data-testid="pocket-resize-handle-ne"]',
        ) as SVGRectElement
      ).style.cursor,
    ).toBe("nesw-resize");
    expect(
      (
        container.querySelector(
          '[data-testid="pocket-resize-handle-e"]',
        ) as SVGRectElement
      ).style.cursor,
    ).toBe("ew-resize");
    expect(container.querySelector('[data-testid="pocket-rotate-handle"]')).not.toBeNull();
    const editContour = container.querySelector(
      '[data-testid="button-edit-contour"]',
    ) as HTMLButtonElement;
    React.act(() => editContour.click());
    expect(editContour.getAttribute("aria-label")).toBe("Finish contour editing");
    expect(container.querySelector('[data-testid="layout-canvas"]')).not.toBeNull();
    expect(
      (container.querySelector(
        '[data-testid="button-layout-ruler"]',
      ) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(container.querySelector("[data-cutout-id]")).not.toBeNull();
    expect(
      container.querySelectorAll('[data-testid="contour-vertex-handle"]'),
    ).toHaveLength(4);
    expect(container.querySelector('[data-testid^="finger-hole-oblong-deep-scoop-"]')).not.toBeNull();
    expect(container.querySelector("[data-rotate-handle]")).toBeNull();

    React.act(() => {
      container
        .querySelector('[data-testid="contour-vertex-handle"]')!
        .dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
        );
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(
      container.querySelectorAll('[data-testid="contour-vertex-handle"]'),
    ).toHaveLength(3);

    const historyButton = container.querySelector(
      '[data-testid="button-bin-history"]',
    ) as HTMLButtonElement;
    React.act(() => historyButton.click());
    expect(document.body.textContent).toContain("Edit history");
    expect(document.body.textContent).toContain("Remove contour node");
    React.act(() => historyButton.click());

    React.act(() => {
      (
        container.querySelector(
          '[data-testid="button-bin-undo"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(
      container.querySelectorAll('[data-testid="contour-vertex-handle"]'),
    ).toHaveLength(4);
    React.act(() => {
      (
        container.querySelector(
          '[data-testid="button-bin-redo"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(
      container.querySelectorAll('[data-testid="contour-vertex-handle"]'),
    ).toHaveLength(3);

    // Finishing restores the normal placement handles and rotation cursor.
    React.act(() => editContour.click());
    const rotateHandle = container.querySelector("[data-rotate-handle]") as SVGElement;
    expect(rotateHandle.style.cursor).toContain("/cursors/rotate.svg");
    unmount();
  });

  it("asks how to resize after removal and fits an off-centre survivor", async () => {
    let libraryHandle: import("@/state/shape-library").ShapeLibrary | null = null;
    function LibraryProbe() {
      libraryHandle = ShapeLibraryModule.useShapeLibrary();
      return null;
    }

    const { container, unmount } = render(
      <PanelProvider>
        <ShapeLibraryProvider>
          <LibraryProbe />
          <BinDesignerPage />
        </ShapeLibraryProvider>
      </PanelProvider>,
    );
    await flushHydration();

    React.act(() => {
      libraryHandle!.addShape(rectangularShape("shape-a", "first part"));
      libraryHandle!.addShape(rectangularShape("shape-b", "second part"));
    });
    await React.act(async () => Promise.resolve());

    const twoCellSize =
      container.querySelector("#bin-settings-size")?.textContent ?? "";
    expect(
      ["2 × 1 × 6u", "1 × 2 × 6u"].some((label) =>
        twoCellSize.includes(label),
      ),
    ).toBe(true);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid^="button-remove-"]')!.click());
    expect(document.body.textContent).toContain(
      "Resize the bin after removing “first part”?",
    );
    expect(container.querySelectorAll('[data-testid^="cutout-row-"]')).toHaveLength(2);

    await React.act(async () => {
      (
        document.querySelector(
          '[data-testid="button-remove-pocket-and-fit"]',
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });

    expect(container.querySelectorAll('[data-testid^="cutout-row-"]')).toHaveLength(1);
    expect(
      container.querySelector("#bin-settings-size")?.textContent,
    ).toContain("1 × 1 × 6u");
    unmount();
  });

  it.each([
    { layout: "standard", mobile: false }, { layout: "workflow", mobile: false },
    { layout: "standard", mobile: true }, { layout: "workflow", mobile: true },
  ])("warns about missing cutouts only when solid fill is enabled: %o", async ({ layout, mobile }) => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT,
      spec: parseBinSpec({ ...EMPTY_PROJECT.spec, fill: "none", fillHeightPercent: 37.5 }),
    });
    const { container, unmount } = renderPage({ mobile });
    try {
      await flushHydration();
      openSettingsSection(container, "export");
      const warning = () => container.querySelector('[data-testid="export-no-cutouts-warning"]');
      expect(warning()).toBeNull();
      if (layout === "standard") {
        expect(container.querySelector("#bin-settings-export [data-panel-section-trigger]")?.textContent).toContain("Ready");
      }
      for (const format of ["3mf", "stl"]) {
        expect(container.querySelector<HTMLButtonElement>(`[data-testid="button-export-${format}"]`)!.disabled).toBe(false);
      }
      openSettingsSection(container, "construction");
      React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Solid fill"]')!.click());
      openSettingsSection(container, "export");
      expect(warning()?.textContent).toContain("Solid fill is enabled at 37.5% height");
      expect(warning()?.textContent).not.toContain("The final model is a solid bin");
      clickBinHistory(container, "undo");
      expect(warning()).toBeNull();
      clickBinHistory(container, "redo");
      expect(warning()?.textContent).toContain("Solid fill is enabled at 37.5% height");
    } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
  });});

it("preserves restored linked designs and standard selection while opted out", async () => {
  const shape = rectangularShape("experimental-shape", "Target");
  const cutouts = [-18, 18].map((x, i) => parseCutoutPlacement({
    id: `experimental-${i}`, name: `Target ${i}`, shapeId: shape.id, position: { x, y: 0 },
    tilt: { xDeg: 15, yDeg: 0 }, depth: { mode: "mm", value: 8 }, designLink: { id: "targets" },
  }));
  const hole = fingerHoleSchema.parse({ id: "access", name: "Access", center: { x: 0, y: 26 }, designLink: { id: "access-design" } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts, fingerHoles: [hole] });
  const { container, unmount } = renderPage({ experimental: false });
  try {
    await flushHydration();
    const before = structuredClone(vi.mocked(useBinGeometry).mock.lastCall![2]);
    expect(container.querySelector('[data-experimental-editor="true"]')).not.toBeNull();
    expect(projectToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Experimental features enabled" }));
    React.act(() => experimentalSettings.setEnabled(false));
    expect(container.querySelector('[data-experimental-editor="true"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="experimental-design-notice"]')).not.toBeNull();
    openSettingsSection(container, "tool-cutouts"); selectPocket(container, cutouts[0].id);
    expect(container.querySelector('[aria-label="Linked design"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pocket-rotation-controls"]')).not.toBeNull();
    expect(container.querySelector('[aria-label^="Include Target"]')).not.toBeNull();
    React.act(() => container.querySelector<HTMLButtonElement>(`[data-testid="button-select-${cutouts[1].id}"]`)!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true })));
    expect(container.querySelector(`[data-testid="button-select-${cutouts[0].id}"]`)?.getAttribute("aria-pressed")).toBe("true");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true })));
    expect(container.querySelector('[data-testid="pocket-3d-controls"]')).toBeNull();

    React.act(() => experimentalSettings.setEnabled(true));
    expect(container.querySelector('[aria-label="Linked design"]')).not.toBeNull();
    expect(container.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(2);
    React.act(() => container.querySelector<HTMLInputElement>('[aria-label="Include Target 0 in selection"]')!.click());
    React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Object controls"]')!.click());
    expect(container.querySelector('[data-testid="pocket-3d-controls"]')).not.toBeNull();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-3d"]')!.click());
    expect(container.querySelector('[data-experimental-editor="true"]')).not.toBeNull();

    React.act(() => experimentalSettings.setEnabled(false));
    expect(container.querySelector('[data-experimental-editor="true"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Linked design"]')).not.toBeNull();
    expect(vi.mocked(useBinGeometry).mock.lastCall![2]).toEqual(before);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
    openSettingsSection(container, "project");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-export-project"]')!.click());
    const [blob] = vi.mocked(downloadBlob).mock.lastCall!;
    const json = await new Promise<string>(resolve => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob);
    });
    const exported = parseProjectDoc(JSON.parse(json))!;
    expect(exported.cutouts).toEqual(cutouts); expect(exported.fingerHoles).toEqual([hole]);
    expect(localStorage.getItem(EXPERIMENTAL_FEATURES_KEY)).toBe("false");
  } finally { unmount(); }
});

it.each(["release", "Escape", "blur", "pointercancel", "disable experimental"])("%s of a mixed selection drag is one atomic edit or a complete cancellation", async ending => {
  const shape = rectangularShape("multi-shape", "Test pocket");
  const cutouts = [-18, 18].map((x, i) => parseCutoutPlacement({ id: `multi-${i}`, name: `Multi ${i}`, shapeId: shape.id, position: { x, y: 0 } }));
  const hole = fingerHoleSchema.parse({ id: "multi-finger", name: "Test thumb", center: { x: 0, y: 26 }, diameterMm: 8, depthMm: 8 });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts, fingerHoles: [hole] });
  const { container, unmount } = renderPage();
  await flushHydration();
  React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
  openSettingsSection(container, "tool-cutouts");
  for (const name of ["Multi 0", "Multi 1"]) React.act(() => container.querySelector<HTMLInputElement>(`[aria-label="Include ${name} in selection"]`)!.click());
  openSettingsSection(container, "finger-holes");
  React.act(() => container.querySelector<HTMLInputElement>('[aria-label="Include Test thumb in selection"]')!.click());
  React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Object controls"]')!.click());
  expect(container.querySelector('[data-testid="pocket-3d-controls"]')?.textContent).toContain("3 objects selected");
  const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
  Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
  Object.defineProperties(svg, {
    createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) },
    setPointerCapture: { value: () => {} },
  });
  const path = () => svg.querySelector('[data-cutout-id="multi-0"]')!.getAttribute('d');
  const beforePath = path();
  const pointer = (type: string, x: number, y: number) => React.act(() => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, altKey: true });
    Object.defineProperty(event, 'pointerId', { value: 5 }); svg.dispatchEvent(event);
  });
  pointer('pointerdown', 23.75, 41.75); pointer('pointermove', 33.75, 35.75);
  expect(path()).not.toBe(beforePath);
  if (ending === "Escape") React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  else if (ending === "blur") React.act(() => window.dispatchEvent(new Event("blur")));
  else if (ending === "disable experimental") React.act(() => experimentalSettings.setEnabled(false));
  else pointer(ending === "release" ? "pointerup" : "pointercancel", 33.75, 35.75);
  const undo = container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!;
  if (ending === "release") {
    const current = vi.mocked(useBinGeometry).mock.lastCall![2]!;
    expect(current.cutouts.map(c => c.position)).toEqual([{ x: -8, y: 6 }, { x: 28, y: 6 }]);
    expect(current.fingerHoles[0].center).toEqual({ x: 10, y: 32 });
    expect(undo.disabled).toBe(false); React.act(() => undo.click());
  }
  expect(undo.disabled).toBe(true); expect(path()).toBe(beforePath);
  unmount();
});

it.each(["backup", "library"])("preserves experimental opt-out when opening a %s", async source => {
  const project = { id: "saved", name: "Linked access", updatedAt: "2026-09-23T12:00:00.000Z" };
  const doc: ProjectDoc = { ...EMPTY_PROJECT, name: project.name, fingerHoles: [
    fingerHoleSchema.parse({ id: "access", center: { x: 0, y: 0 }, designLink: { id: "linked-access" } }),
  ] };
  vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({ activeProjectId: null, projects: [project] });
  vi.mocked(ProjectPersistence.openProjectFromLibrary).mockResolvedValue({
    doc, project, library: { activeProjectId: project.id, projects: [project] },
  });
  const { container, unmount } = renderPage({ experimental: false });
  try {
    await flushHydration();
    expect(experimentalSettings.enabled).toBe(false);
    expect(projectToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Experimental features enabled" }));
    openSettingsSection(container, "project");
    if (source === "backup") {
      const json = JSON.stringify(doc);
      const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*=".pocketry.json"]')!;
      const file = new File([json], "Linked access.pocketry.json");
      Object.defineProperty(file, "text", { value: async () => json });
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      await React.act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
      expect(ProjectPersistence.importProjectToLibrary).toHaveBeenCalledOnce();
    } else {
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-manage-library"]')!.click());
      await React.act(async () => document.querySelector<HTMLButtonElement>('[data-testid="button-open-project-saved"]')!.click());
      expect(ProjectPersistence.openProjectFromLibrary).toHaveBeenCalledExactlyOnceWith("saved");
    }
    expect(experimentalSettings.enabled).toBe(false);
    expect(localStorage.getItem(EXPERIMENTAL_FEATURES_KEY)).toBe("false");
    expect(projectToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Experimental features enabled" }));
    expect(container.querySelector('[data-testid="experimental-design-notice"]')).not.toBeNull();
    expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.fingerHoles).toEqual(doc.fingerHoles);
  } finally { unmount(); }
});

it.each(["shiftKey", "ctrlKey"])("adds and removes pockets with %s mouse clicks in Layout", async modifier => {
  const shape = rectangularShape("mouse-shape", "Mouse pocket");
  const cutouts = [-18, 18].map((x, i) => parseCutoutPlacement({ id: `mouse-${i}`, shapeId: shape.id, position: { x, y: 0 } }));
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts });
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
    Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
    Object.defineProperties(svg, {
      createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) },
      setPointerCapture: { value: () => {} }, releasePointerCapture: { value: () => {} },
    });
    const click = (x: number, additive: boolean) => React.act(() => {
      for (const type of ["pointerdown", "pointerup"]) {
        const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 41.75, [modifier]: additive });
        Object.defineProperty(event, "pointerId", { value: 11 }); svg.dispatchEvent(event);
      }
    });
    click(23.75, false); click(59.75, true);
    React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Object controls"]')!.click());
    expect(container.querySelector('[data-testid="pocket-3d-controls"]')?.textContent).toContain("2 objects selected");
    click(23.75, true);
    expect(container.querySelector('[data-testid="pocket-3d-controls"]')?.textContent).toContain("1 object selected");
  } finally { unmount(); }
});

it("opens Layout object controls with W/E and returns from Links or Arrange to the same mode", async () => {
  const shape = rectangularShape('shortcut-shape', 'Shortcut pocket');
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({...EMPTY_PROJECT, shapes:[shape], cutouts:[0,1].map(i=>parseCutoutPlacement({id:`shortcut-${i}`,shapeId:shape.id,position:{x:i*20,y:0}}))});
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    selectPocket(container, "shortcut-0");
    React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", {key:"a",ctrlKey:true})));
    const button = (name: string) => container.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!;
    for (const [key, mode] of [["w", "Move pocket (W)"], ["e", "Rotate pocket (E)"]] as const) {
      React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key })));
      expect(button(mode).getAttribute("aria-pressed")).toBe("true");
      expect(container.querySelector('[data-testid="layout-add-pocket"]')).toBeNull();
      expect(container.querySelector('.bin-canvas-guidance')).toBeNull();
      for (const tab of ["Link and unlink designs", "Align and distribute objects"]) {
        React.act(() => button(tab).click());
        React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key })));
        expect(button(mode).getAttribute("aria-pressed")).toBe("true");
      }
    }
    React.act(() => button("Close object controls").click());
    expect(container.querySelector('[data-testid="toolbar-add-object"]')).not.toBeNull();
    React.act(() => experimentalSettings.setEnabled(false));
    React.act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" })));
    expect(container.querySelector('[data-testid="pocket-3d-controls"]')).not.toBeNull();
  } finally { unmount(); }
});

it("rejects overflowing numeric moves without corrupting the document or undo history", async () => {
  const shape = rectangularShape("overflow-shape", "Overflow pocket");
  const cutout = parseCutoutPlacement({ id: "overflow-pocket", shapeId: shape.id, position: { x: 0, y: 0 } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [cutout] });
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    openSettingsSection(container, "tool-cutouts"); selectPocket(container, cutout.id);
    React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Object controls"]')!.click());
    const input = container.querySelector<HTMLInputElement>('[aria-label="Move X by"]')!;
    for (const value of ["1e308", "-1e308"]) {
      React.act(() => {
        input.focus();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      React.act(() => input.blur());
      expect(container.querySelector('[data-testid="pocket-3d-controls"] [role="status"]')?.textContent).toContain("Enter a number from -1000000 to 1000000");
      expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]?.cutouts).toEqual([cutout]);
    }
  } finally { unmount(); }
});

it.each([
  { mobile: false, experimental: false }, { mobile: true, experimental: false },
  { mobile: false, experimental: true }, { mobile: true, experimental: true },
])("workflow toolbar Add menu creates pockets and finger access with undo: %o", async ({ mobile, experimental }) => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, "", "/bin?layout=workflow");
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(EMPTY_PROJECT);
  const { container, unmount } = renderPage({ mobile, experimental });
  try {
    await flushHydration();
    const click = (id: string) => { const target = id === "button-bin-redo" ? binHistoryButton(container, "redo") : container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!; React.act(() => target.click()); };
    click("view-toggle-2d");
    const toolbar = container.querySelector('[aria-label="Editing tools"]')!;
    let add = toolbar.querySelector('[data-testid="toolbar-add-object"]')!;
    expect(toolbar.querySelectorAll('[data-testid="toolbar-add-object"]')).toHaveLength(1);
    expect([...toolbar.querySelectorAll('button')][0]).toBe(add);
    expect(container.querySelector('[data-testid="layout-add-pocket"]')).toBeNull();
    const pan = toolButton(container, "Pan layout");
    React.act(() => pan.click());
    const choose = (itemLabel: string) => {
      add = toolbar.querySelector('[data-testid="toolbar-add-object"]')!;
      React.act(() => add.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      React.act(() => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === itemLabel)!.click());
    };
    choose("Rectangle pocket");
    if (mobile) React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === "Draw on canvas")!.click());
    if (!mobile) expect(container.querySelector('[aria-label="Pan layout"]')!.getAttribute("aria-pressed")).toBe("false");
    const svg = container.querySelector<SVGSVGElement>('[data-testid="layout-canvas"]')!;
    Object.defineProperty(svg.querySelector('g')!, 'getScreenCTM', { value: () => ({ inverse: () => ({}) }) });
    Object.defineProperties(svg, {
      createSVGPoint: { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) },
      setPointerCapture: { value: () => {} },
    });
    for (const [type, x, y] of [["pointerdown", 30, 30], ["pointermove", 50, 45], ["pointerup", 50, 45]] as const) {
      React.act(() => svg.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y })));
    }
    const layout = () => vi.mocked(useBinGeometry).mock.lastCall![2]!;
    expect(layout().cutouts).toHaveLength(1);
    choose("Circle pocket");
    if (mobile) React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === "Draw on canvas")!.click());
    expect(container.textContent).toContain("Draw circle");
    React.act(() => container.querySelector<HTMLButtonElement>('[aria-label="Cancel drawing"]')!.click());
    choose("Finger access");
    expect(container.textContent).not.toContain("Draw circle");
    expect(layout().fingerHoles).toHaveLength(1);
    expect(layout().fingerHoles[0]).toMatchObject({ kind: "oblong-deep-scoop", slotEnds: "rounded", lengthMm: 36 });
    if (mobile) openMobileProperties();
    expect(container.querySelector('#finger-access-properties')?.closest('[hidden]')).toBeNull();
    click("button-bin-undo");
    expect(layout().fingerHoles).toEqual([]);
    expect(layout().cutouts).toHaveLength(1);
    click("button-bin-redo");
    expect(layout().fingerHoles).toHaveLength(1);
  } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
});

it("keeps finger-access guidance beside the collapsed section title without toggling it", async () => {
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    const section = container.querySelector<HTMLElement>('#bin-settings-finger-holes')!;
    const toggle = section.querySelector<HTMLButtonElement>('[data-panel-section-trigger]')!;
    const hint = section.querySelector<HTMLButtonElement>('[aria-label="About finger access"]')!;
    expect(hint.closest('[data-panel-section-header]')).toBe(toggle.parentElement);
    expect(toggle.contains(hint)).toBe(false);
    expect(section.dataset.state).toBe('closed');
    await React.act(async () => hint.click());
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('Allow room beside the tool');
    expect(section.dataset.state).toBe('closed');
    React.act(() => hint.click());
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    React.act(() => toggle.click());
    expect(section.dataset.state).toBe('open');
    expect(section.querySelector('[aria-label="About openings"]')).toBeNull();
  } finally { unmount(); }
});

it("prototype keeps selection and list position while batch editing, undoing and switching panels", async () => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, "", "/bin?layout=workflow");
  const shape = rectangularShape("proto", "Tool");
  const cutouts = [10, 20].map((value, i) => parseCutoutPlacement({ id: `proto-${i}`, name: `Tool ${i + 1}`, shapeId: shape.id, position: { x: i * 40 - 20, y: 0 }, depth: { mode: "mm", value } }));
  const finger = fingerHoleSchema.parse({ id: "proto-f", name: "Tool access", center: { x: 0, y: 0 }, depthMm: 8 });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, spec: parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 6 }), shapes: [shape], cutouts, fingerHoles: [finger] });
  const { container, unmount } = renderPage({ experimental: true });
  try {
    await flushHydration();
    const clickText = (text: string, within: ParentNode = container) => React.act(() => [...within.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!.click());
    const choose = (name: string) => React.act(() => container.querySelector<HTMLInputElement>(`[aria-label="Include ${name} in selection"]`)!.click());
    const list = container.querySelector('[data-testid="object-list-scroll"]')!;
    list.scrollTop = 150;
    selectPocket(container, 'proto-0');
    expect(container.querySelector('#pocket-properties')!.closest('[data-testid="selection-inspector"]')).not.toBeNull();
    const header = container.querySelector('[data-testid="inspector-properties-header"]')!;
    expect(header.querySelector('h3')?.textContent).toBe('Tool 1');
    expect(container.querySelector('[aria-label="Pocket cut depth in millimetres"]')).not.toBeNull();
    expect(container.querySelector<HTMLDetailsElement>('[data-testid="pocket-clearance-settings"]')!.open).toBe(false);
    expect(container.querySelector('#pocket-properties')!.lastElementChild?.getAttribute('data-testid')).toBe('pocket-clearance-settings');
    expect(container.querySelector('[aria-label="Top edge rounding in millimetres"]')!.closest('details')!.dataset.testid).toBe('pocket-edge-settings');
    expect(header.querySelector('[aria-label="Duplicate selection"]')).toBeNull();
    expect(list.querySelector('[aria-label="Actions for Tool 1"]')).not.toBeNull();
    expect(list.scrollTop).toBe(150);
    choose('Tool 2'); choose('Tool access');
    expect(container.querySelector('#pocket-properties')).toBeNull();
    const inspector = container.querySelector('[data-testid="selection-inspector"]')!;
    expect(inspector.textContent).toContain('3 selected');
    const input = inspector.querySelector<HTMLInputElement>('[aria-label="Fixed cut depth for selected pockets"]')!;
    expect(input.value).toBe(''); expect(input.placeholder).toBe('Mixed');
    React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '14');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    React.act(() => inspector.querySelector<HTMLButtonElement>('[aria-label="Apply fixed cut depth to selected pockets"]')!.click());
    const doc = () => ({ cutouts: vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts, fingers: vi.mocked(useBinGeometry).mock.lastCall![2]!.fingerHoles });
    expect(doc().cutouts.map(c => c.depth)).toEqual([{ mode: 'mm', value: 14 }, { mode: 'mm', value: 14 }]);
    expect(doc().fingers).toEqual([finger]);
    expect(inspector.textContent).toContain('3 selected'); expect(list.scrollTop).toBe(150);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(doc().cutouts.map(c => c.depth)).toEqual(cutouts.map(c => c.depth));
    expect(inspector.textContent).toContain('3 selected');
    const workflow = container.querySelector('#workflow-panel')!;
    expect(workflow.querySelector('[aria-label="Choose a pocket to edit"]')).not.toBeNull();
    expect(workflow.querySelector('#bin-settings-pockets')).not.toBeNull();
    expect(workflow.querySelector('#bin-settings-size, #bin-settings-project, #bin-settings-export')).toBeNull();
    const clickLabel = (label: string) => React.act(() => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
    clickLabel('Collapse workflow panel');
    expect(workflow.hasAttribute('hidden')).toBe(true);
    expect(inspector.querySelector('[data-testid="batch-properties"]')).not.toBeNull();
    clickLabel('Expand workflow panel');
    expect(container.querySelectorAll('[aria-label^="Include "]:checked')).toHaveLength(3);
    clickText('Layout');
    expect(inspector.querySelector('[data-testid="pocket-3d-controls"]')).not.toBeNull();
    expect(inspector.querySelector('[aria-label="Objects in selection"]')).toBeNull();
    clickLabel('Collapse properties panel');
    clickLabel('Rotate selected objects');
    expect(inspector.closest('[hidden]')).toBeNull();
    expect(inspector.querySelector('[aria-label="Rotate Z by"]')).not.toBeNull();
    expect(header.querySelector('h3')?.textContent).toBe('3 selected');
    expect(inspector.querySelector('[data-testid="inspector-active-tool"]')!.textContent).toContain('Rotate');
    expect(header.querySelector('[aria-label="Duplicate selection"]')).not.toBeNull();
    clickLabel('Back to properties');
    expect(inspector.querySelector('[data-testid="batch-properties"]')!.closest('[hidden]')).toBeNull();
    clickLabel('Move selected objects');
    const moveX = inspector.querySelector<HTMLInputElement>('[aria-label="Move X by"]')!;
    React.act(() => {
      moveX.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(moveX, '5');
      moveX.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(doc().cutouts.map(c => c.position)).toEqual(cutouts.map(c => c.position));
    React.act(() => moveX.blur());
    expect(doc().cutouts.map(c => c.position.x)).toEqual(cutouts.map(c => c.position.x + 5));
    expect(doc().fingers[0].center.x).toBe(finger.center.x + 5);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(doc().cutouts.map(c => c.position)).toEqual(cutouts.map(c => c.position));
    expect(doc().fingers).toEqual([finger]);
    expect(moveX.value).toBe('0');
    expect(list.scrollTop).toBe(150);
    clickLabel('Arrange selected objects');
    expect(inspector.querySelector('[aria-label="Align top edges"]')?.textContent).toBe('');
    clickLabel('Align horizontal centers');
    expect(doc().cutouts[0].position.x).toBe(doc().cutouts[1].position.x);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(doc().cutouts.map(c => c.position)).toEqual(cutouts.map(c => c.position));
    expect(list.scrollTop).toBe(150);
    selectPocket(container, 'proto-0');
    expect(container.querySelector('#pocket-properties')!.closest('[hidden]')).toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Arrange selected objects"]')!.disabled).toBe(true);
  } finally { unmount(); window.history.replaceState(null, '', originalUrl); }
});

it.each([
  { layout: "standard", experimental: false }, { layout: "workflow", experimental: false },
  { layout: "standard", experimental: true }, { layout: "workflow", experimental: true },
])("ordinary properties keep linking optional in $layout (experimental: $experimental)", async ({ layout, experimental }) => {
  window.history.replaceState(null, '', `/bin?layout=${layout}`);
  const shape = rectangularShape('ordinary-link-review', 'Tool');
  const cutout = parseCutoutPlacement({ id: 'ordinary', shapeId: shape.id, position: { x: 0, y: 0 } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [cutout] });
  const { container, unmount } = renderPage({ experimental });
  try {
    await flushHydration(); selectPocket(container, cutout.id);
    const disclosure = container.querySelector<HTMLDetailsElement>('[data-testid="linked-copies-disclosure"]');
    if (experimental) {
      expect(disclosure).not.toBeNull(); expect(disclosure!.open).toBe(false);
      expect(disclosure!.querySelector('[aria-label="Linked design"]')).not.toBeNull();
    } else {
      expect(disclosure).toBeNull();
      expect(container.querySelector('[aria-label="Linked design"]')).toBeNull();
      expect(container.querySelector('[aria-label="Link and unlink selected objects"]')).toBeNull();
    }
    expect(container.querySelector('[data-testid="pocket-depth-summary"]')).not.toBeNull();
    expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual([cutout]);
  } finally { unmount(); }
});

it("prototype renames from the object menu without losing inline focus or changing selection", async () => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, '', '/bin?layout=workflow');
  const shape = rectangularShape('rename-menu', 'Pliers');
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [parseCutoutPlacement({ id: 'rename-p', shapeId: shape.id, position: { x: 0, y: 0 } })] });
  const { container, unmount } = renderPage({ mobile: true });
  try {
    await flushHydration();
    React.act(() => [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Workflow')!.click());
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Actions for Pliers"]')!;
    React.act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    React.act(() => document.querySelector<HTMLElement>('[role="menuitem"][aria-label="Rename Pliers"]')!.click());
    await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    const input = container.querySelector<HTMLInputElement>('[aria-label="Pocket name"]')!;
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(container.querySelector('#workflow-panel')!.hasAttribute('hidden')).toBe(false);
    expect(container.querySelector('[data-testid="inspector-properties-header"] h3')!.textContent).toBe('Bin size');
    React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Renamed pliers');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    React.act(() => input.blur());
    expect(container.querySelector('[aria-label="Renamed pliers — edit pocket properties"]')).not.toBeNull();
  } finally { unmount(); window.history.replaceState(null, '', originalUrl); }
});

it.each(['standard', 'workflow'])("keeps the cross-section preview inside Check fit in the %s layout", async layout => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, '', `/bin?layout=${layout}`);
  const shape = rectangularShape('fit-tool', 'Tool');
  const cutout = parseCutoutPlacement({ id: 'fit-pocket', shapeId: shape.id, position: { x: 0, y: 0 } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [cutout] });
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    selectPocket(container, cutout.id);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    if (layout === 'standard') openSettingsSection(container, 'check-fit');
    else React.act(() => Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Check fit')!.click());
    expect(document.querySelector('#bin-settings-view')).toBeNull();
    const fit = document.querySelector('#bin-settings-fit')!;
    const group = fit.querySelector<HTMLDetailsElement>('[data-testid="cross-section-settings"]')!;
    expect(group.open).toBe(false);
    expect(group.textContent).toContain('Inspect inside');
    React.act(() => group.querySelector('summary')!.click());
    expect(group.open).toBe(true);
    const toggle = group.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Cut the preview open"]')!;
    React.act(() => toggle.click());
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(vi.mocked(useBinGeometry).mock.lastCall![3]).toEqual({ axis: 'x', offsetMm: 0 });
    expect(container.querySelector('[data-testid="button-show-full-bin"]')).not.toBeNull();
    expect(group.querySelector('[aria-label="Cross-section axis"]')).not.toBeNull();
    expect(group.open).toBe(true);
    React.act(() => toggle.click());
    expect(vi.mocked(useBinGeometry).mock.lastCall![3]).toBeNull();
    expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual([cutout]);
    expect(fit.querySelector('[data-testid="button-export-surface-fit-test"]')).not.toBeNull();
  } finally { unmount(); window.history.replaceState(null, '', originalUrl); }
});

it.each(['standard', 'workflow'])("Pan exclusively owns the canvas tools in the %s layout", async layout => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, '', `/bin?layout=${layout}`);
  const shape = rectangularShape('pan-tool', 'Tool');
  const cutout = parseCutoutPlacement({ id: 'pan-pocket', shapeId: shape.id, position: { x: 0, y: 0 } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: [cutout] });
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    selectPocket(container, cutout.id);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click());
    const button = (label: string) => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
    React.act(() => button('Measure between contours').click());
    React.act(() => button('Pan layout').click());
    const pan = button('Pan layout');
    expect(pan.getAttribute('aria-pressed')).toBe('true');
    expect(pan.className).toContain('bg-accent');
    expect(button('Fit layout to screen').disabled).toBe(false);
    expect(button('Measure between contours').disabled).toBe(true);
    expect(button('Measure between contours').getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-layout-edit-contour"]')!.disabled).toBe(true);
    if (layout !== 'standard') {
      for (const label of ['Select objects', 'Move selected objects', 'Rotate selected objects', 'Arrange selected objects', 'Link and unlink selected objects']) {
        expect(button(label).disabled).toBe(true);
        expect(button(label).getAttribute('aria-pressed')).toBe('false');
      }
    } else expect(button('Object controls').disabled).toBe(true);
    React.act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    });
    expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual([cutout]);
    React.act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(pan.getAttribute('aria-pressed')).toBe('false');
    expect(button('Measure between contours').disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-layout-edit-contour"]')!.disabled).toBe(false);
    if (layout !== 'standard') expect(button('Move selected objects').disabled).toBe(false);
  } finally { unmount(); window.history.replaceState(null, '', originalUrl); }
});

it.each([
  { layout: 'standard', kind: 'pocket' },
  { layout: 'standard', kind: 'finger' },
  { layout: 'workflow', kind: 'pocket' },
  { layout: 'workflow', kind: 'finger' },
  { layout: 'standard', kind: 'text' },
  { layout: 'workflow', kind: 'text' },
] as const)('double-click renames a $kind in the $layout layout with focus, cancellation and undo', async ({ layout, kind }) => {
  const originalUrl = window.location.href;
  window.history.replaceState(null, '', `/bin?layout=${layout}`);
  const shape = rectangularShape('rename-shape', 'Tool');
  const pockets = [-20, 20].map((x, index) => parseCutoutPlacement({ id: `rename-pocket-${index}`, shapeId: shape.id, position: { x, y: 0 } }));
  const finger = fingerHoleSchema.parse({ id: 'rename-finger', center: { x: 0, y: 25 } });
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts: pockets, fingerHoles: [finger], spec: parseBinSpec({ ...EMPTY_PROJECT.spec, surfaceTexts: [{ id: "rename-text-0", text: "Tool", position: { x: 0, y: 0 } }] }) });
  const { container, unmount } = renderPage();
  try {
    await flushHydration();
    openSettingsSection(container, kind === 'pocket' ? 'tool-cutouts' : kind === 'finger' ? 'finger-holes' : 'text');
    const selector = kind === 'pocket' ? '[data-testid="button-select-rename-pocket-0"]' : kind === 'finger' ? '[data-testid="button-select-finger-hole-rename-finger"]' : '[data-testid="button-select-surface-text-rename-text-0"]';
    const originalName = kind === 'finger' ? 'Finger access 1' : 'Tool';
    const nameButton = () => container.querySelector<HTMLButtonElement>(selector)!;
    const beginRename = () => {
      const button = nameButton();
      React.act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
      expect(container.querySelector('input[aria-label="Pocket name"], input[aria-label="Finger access name"], input[aria-label="Surface text name"]')).toBeNull();
      React.act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 })));
      React.act(() => button.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 })));
      const input = container.querySelector<HTMLInputElement>(`[aria-label="${kind === 'pocket' ? 'Pocket' : kind === 'finger' ? 'Finger access' : 'Surface text'} name"]`)!;
      expect(input).not.toBeNull();
      expect(document.activeElement).toBe(input);
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(input.value.length);
      return input;
    };
    const typeName = (input: HTMLInputElement, value: string) => React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    let input = beginRename();
    expect(input.value).toBe(originalName);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
    typeName(input, '  Renamed item  ');
    React.act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(nameButton().textContent).toBe('Renamed item');
    expect(nameButton().getAttribute('aria-pressed')).toBe('true');
    expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts[1]).toEqual(pockets[1]);
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.click());
    expect(nameButton().textContent).toBe(originalName);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
    clickBinHistory(container, "redo");
    expect(nameButton().textContent).toBe('Renamed item');
    input = beginRename();
    typeName(input, 'Cancelled');
    React.act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(nameButton().textContent).toBe('Renamed item');
    input = beginRename();
    typeName(input, '   ');
    React.act(() => input.blur());
    expect(nameButton().textContent).toBe('Renamed item');
    input = beginRename();
    typeName(input, 'Saved on blur');
    React.act(() => input.blur());
    expect(nameButton().textContent).toBe('Saved on blur');
    if (kind === 'text') {
      expect(vi.mocked(useBinGeometry).mock.lastCall![0].surfaceTexts[0]).toMatchObject({ name: 'Saved on blur', text: 'Tool' });
      expect(container.querySelector<HTMLInputElement>('[data-testid="surface-text-editor"] input[type="text"]')!.value).toBe('Tool');
    }
  } finally { unmount(); window.history.replaceState(null, '', originalUrl); }
});

it.each(['Move selected objects', 'Rotate selected objects', 'Arrange selected objects', 'Link and unlink selected objects'])(
  'respects the experimental toggle in Workflow after using %s', async activeTool => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, '', '/bin?layout=workflow');
    const shape = rectangularShape('optional-tool-shape', 'Tool');
    const cutouts = [-20, 20].map((x, i) => parseCutoutPlacement({ id: `optional-tool-${i}`, name: `Tool ${i + 1}`, shapeId: shape.id,
      position: { x, y: 0 }, depth: { mode: 'mm', value: 12 } }));
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts });
    const { container, unmount } = renderPage({ experimental: false });
    const basicLabels = ['Move selected objects', 'Rotate selected objects'];
    const advancedLabels = ['Link and unlink selected objects'];
    const button = (label: string) => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
    const clickView = (view: string) => React.act(() => container.querySelector<HTMLButtonElement>(`[data-testid="view-toggle-${view}"]`)!.click());
    try {
      await flushHydration();
      expect(container.querySelector('[data-experimental-editor="true"]')).not.toBeNull();
      clickView('2d');
      selectPocket(container, cutouts[0].id);
      for (const label of advancedLabels) expect(button(label)).toBeNull();
      for (const label of basicLabels) {
        expect(button(label)!.disabled).toBe(false);
        React.act(() => button(label)!.click());
        expect(container.querySelector('[data-testid="pocket-3d-controls"]')).not.toBeNull();
        expect(button(label)!.getAttribute('aria-pressed')).toBe('true');
      }
      React.act(() => button('Select objects')!.click());
      expect(button('Select objects')!.getAttribute('aria-pressed')).toBe('true');
      expect(container.querySelector('[aria-label^="Include Tool"]')).not.toBeNull();
      expect([...container.querySelectorAll('button')].find(button => button.textContent === 'Select all')).toBeUndefined();
      expect(container.querySelector('#pocket-properties')!.closest('[data-testid="selection-inspector"]')).not.toBeNull();
      React.act(() => experimentalSettings.setEnabled(true));
      React.act(() => container.querySelector<HTMLInputElement>('[aria-label="Include Tool 2 in selection"]')!.click());
      for (const label of advancedLabels) expect(button(label)!.disabled).toBe(false);
      React.act(() => button(activeTool)!.click());
      expect(button(activeTool)!.getAttribute('aria-pressed')).toBe('true');
      React.act(() => experimentalSettings.setEnabled(false));
      for (const label of advancedLabels) expect(button(label)).toBeNull();
      expect(container.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(2);
      expect(button('Arrange selected objects')!.disabled).toBe(false);
      expect(container.querySelector('[data-testid="batch-properties"]')).not.toBeNull();
      if (activeTool === 'Link and unlink selected objects') expect(button('Select objects')!.getAttribute('aria-pressed')).toBe('true');
      else expect(button(activeTool)!.getAttribute('aria-pressed')).toBe('true');
      for (const [key, label] of [['w', 'Move selected objects'], ['e', 'Rotate selected objects']]) {
        React.act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key })));
        expect(button(label)!.getAttribute('aria-pressed')).toBe('true');
        expect(container.querySelector('[data-testid="pocket-3d-controls"]')).not.toBeNull();
      }
      React.act(() => button('Select objects')!.click());
      React.act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true })));
      expect(container.querySelector('[data-testid="inspector-active-tool"]')).toBeNull();
      expect(container.querySelector('[data-testid="pocket-3d-controls"]')?.closest('[hidden]')).not.toBeNull();
      expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual(cutouts);
      expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
      clickView('3d');
      expect(container.querySelector('[data-experimental-editor="true"]')).not.toBeNull();
      React.act(() => experimentalSettings.setEnabled(true));
      expect(container.querySelector('[data-experimental-editor="true"]')).not.toBeNull();
      clickView('2d');
      for (const label of advancedLabels) expect(button(label)).not.toBeNull();
      expect(button('Select objects')!.getAttribute('aria-pressed')).toBe('true');
    } finally { unmount(); window.history.replaceState(null, '', originalUrl); }
  },
);
