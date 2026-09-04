// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PanelProvider } from "@/components/layout/panel-context";
import { WORKSPACES } from "@/components/layout/workspaces";
import * as ShapeLibraryModule from "@/state/shape-library";
import { ShapeLibraryProvider } from "@/state/shape-library";
import { PROJECT_SCHEMA_VERSION, type ProjectDoc } from "@shared/gridfinity/project";
import { parseCutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";

/**
 * Structure smoke tests for the bin designer page, following the pattern of
 * layout.test.tsx: jsdom does no layout and has no WebGL, so the r3f viewport
 * and the worker hook are stubbed and the assertions stay on what the panel
 * renders. The real geometry path is covered headless in
 * lib/gridfinity/bin-worker-handlers.test.ts.
 */

vi.mock("@/components/gridfinity/bin-viewport", () => ({
  BinViewport: ({
    fitSize,
    hasPocketFloor,
    hasStackingRim,
    binColor,
    pocketFloorColor,
    stackingRimColor,
    showPocketFloorColor,
    showStackingRimColor,
    measurementOutlines,
  }: {
    fitSize: { widthMm: number; lengthMm: number; heightMm: number };
    hasPocketFloor: boolean;
    hasStackingRim: boolean;
    binColor: string;
    pocketFloorColor: string;
    stackingRimColor: string;
    showPocketFloorColor: boolean;
    showStackingRimColor: boolean;
    measurementOutlines: readonly unknown[];
  }) => (
    <div
      data-testid="bin-viewport-stub"
      data-fit-width={fitSize.widthMm}
      data-fit-length={fitSize.lengthMm}
      data-fit-height={fitSize.heightMm}
      data-pocket-floor-color={
        hasPocketFloor && showPocketFloorColor ? "on" : "off"
      }
      data-stacking-rim-color={
        hasStackingRim && showStackingRimColor ? "on" : "off"
      }
      data-bin-color={binColor}
      data-floor-color={pocketFloorColor}
      data-rim-color={stackingRimColor}
    >
      <button
        type="button"
        data-testid="button-3d-ruler"
        disabled={measurementOutlines.length === 0}
      />
    </div>
  ),
}));

const binGeometryMock = vi.hoisted(() => ({
  building: false,
  progress: 1,
  builtSpec: null as ReturnType<typeof parseBinSpec> | null,
  hasPocketFloor: false,
  hasStackingRim: true,
}));

vi.mock("@/lib/gridfinity/use-bin-geometry", () => ({
  useBinGeometry: () => ({
    geometry: null,
    hasPocketFloor: binGeometryMock.hasPocketFloor,
    hasStackingRim: binGeometryMock.hasStackingRim,
    builtSpec: binGeometryMock.builtSpec,
    stats: { triangles: 8400, volumeMm3: 82404, buildMs: 45 },
    cutoutReports: [],
    building: binGeometryMock.building,
    progress: binGeometryMock.progress,
    error: null,
    buildOnce: vi.fn(),
    buildFitCheck: vi.fn(),
    buildSurfaceFitCheck: vi.fn(),
  }),
}));

// Deterministic persistence: no stored project, writes are no-ops. Hydration
// still resolves asynchronously, hence the `flushHydration` below.
vi.mock("@/lib/project/persist", () => ({
  loadProjectDoc: vi.fn(async () => null),
  loadProjectLibrary: vi.fn(async () => ({ activeProjectId: null, projects: [] })),
  saveProjectDoc: vi.fn(async () => {}),
  saveProjectToLibrary: vi.fn(),
  openProjectFromLibrary: vi.fn(),
  deleteProjectFromLibrary: vi.fn(),
  startNewProject: vi.fn(async () => ({ activeProjectId: null, projects: [] })),
  createDebouncedProjectSaver: () => Object.assign(vi.fn(), { cancel: vi.fn() }),
}));

import * as ProjectPersistence from "@/lib/project/persist";

const EMPTY_PROJECT: ProjectDoc = {
  schemaVersion: PROJECT_SCHEMA_VERSION,
  shapes: [],
  spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6 }),
  cutouts: [],
  fingerHoles: [],
};

function rectangularShape(id: string, name: string): TracedShape {
  return {
    id,
    name,
    outlineMm: [
      {
        outer: [
          { x: -15, y: -10 },
          { x: 15, y: -10 },
          { x: 15, y: 10 },
          { x: -15, y: 10 },
        ],
        holes: [],
      },
    ],
    bboxMm: { minX: -15, minY: -10, maxX: 15, maxY: 10 },
    pointCount: 4,
    sourceMmPerPx: 0.5,
  };
}

async function flushHydration() {
  await React.act(async () => {
    await Promise.resolve();
  });
}

// The page is imported after the mocks so it binds to the stubs.
const { default: BinDesignerPage } = await import("./bin-designer");

class NoopResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function render(ui: React.ReactElement, { mobile = false } = {}) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: mobile,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  Object.defineProperty(window, "innerWidth", {
    value: mobile ? 400 : 1440,
    writable: true,
    configurable: true,
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  React.act(() => root.render(ui));

  const result = {
    container,
    unmount: () => {
      React.act(() => root.unmount());
      container.remove();
    },
  };
  return result;
}

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.localStorage?.clear();
});

beforeEach(() => {
  vi.clearAllMocks();
  binGeometryMock.building = false;
  binGeometryMock.progress = 1;
  binGeometryMock.builtSpec = null;
  binGeometryMock.hasPocketFloor = false;
  binGeometryMock.hasStackingRim = true;
  vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(null);
  vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({
    activeProjectId: null,
    projects: [],
  });
  vi.mocked(ProjectPersistence.startNewProject).mockResolvedValue({
    activeProjectId: null,
    projects: [],
  });
  vi.mocked(ProjectPersistence.saveProjectToLibrary).mockImplementation(
    async (_doc, name, projectId) => ({
      activeProjectId: projectId ?? "project-1",
      projects: [
        {
          id: projectId ?? "project-1",
          name: name.trim(),
          updatedAt: "2026-08-24T12:00:00.000Z",
        },
      ],
    }),
  );
});

function renderPage() {
  return render(
    <PanelProvider>
      <ShapeLibraryProvider>
        <BinDesignerPage />
      </ShapeLibraryProvider>
    </PanelProvider>,
  );
}

function openSettingsSection(
  container: HTMLElement,
  section:
    | "project"
    | "construction"
    | "tool-cutouts"
    | "finger-holes"
    | "export",
): void {
  React.act(() => {
    (
      container.querySelector(
        `[data-testid="bin-settings-jump-${section}"]`,
      ) as HTMLButtonElement
    ).click();
  });
}

describe("BinDesignerPage", () => {
  it("is registered as the /bin workspace", () => {
    const entry = WORKSPACES.find((workspace) => workspace.path === "/bin");
    expect(entry).toBeDefined();
    expect(entry!.label).toBe("Bin");
  });

  it("renders the size and feature controls with computed dimensions", () => {
    const { container, unmount } = renderPage();
    const sizeText = container.textContent ?? "";
    for (const label of ["Bin size", "Grid pitch", "Width", "Length", "Height"]) {
      expect(sizeText).toContain(label);
    }
    // Default 2×2×6: 83.5 × 83.5, 42 + 3.55 lip.
    expect(sizeText).toContain("83.5");
    expect(sizeText).toContain("45.6 mm");

    openSettingsSection(container, "construction");
    const constructionText = container.textContent ?? "";
    for (const label of [
      "Stacking lip",
      "Solid fill",
      "Magnet holes",
      "Screw holes",
    ]) {
      expect(constructionText).toContain(label);
    }
    unmount();
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
    expect(sizeSection?.textContent).toContain("1.5 cells · 62.5 mm");
    expect(sizeSection?.textContent).toContain("2 cells · 83.5 mm");
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

    expect(sizeSection?.textContent).toContain("6.5 u · 45.5 mm");
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
    expect(container.querySelector('[data-testid="bin-footprint-summary"]')?.textContent)
      .toContain("3 of 4 cells occupied · custom footprint");
    const edit = container.querySelector('[data-testid="button-edit-footprint"]') as HTMLButtonElement;
    React.act(() => edit.click());
    expect(container.querySelector('[data-testid="layout-canvas"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="footprint-cell"]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-testid="footprint-halo-cell"]')).toHaveLength(6);
    expect(container.querySelector('[data-testid="button-reset-footprint"]')).not.toBeNull();
    unmount();
  });

  it("restores a deep finger scoop with diameter and total-depth controls", async () => {
    const shape = rectangularShape("shape-deep", "Deep pliers");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT,
      shapes: [shape],
      cutouts: [
        parseCutoutPlacement({
          id: "cutout-deep",
          shapeId: shape.id,
          position: { x: 0, y: 0 },
        }),
      ],
      fingerHoles: [
        {
          id: "finger-deep",
          kind: "deep-scoop",
          center: { x: 15, y: 0 },
          diameterMm: 16,
          depthMm: 30,
        },
      ],
    });

    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    React.act(() => {
      (
        container.querySelector(
          '[data-testid="button-select-finger-hole-finger-deep"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(
      container.querySelector('[data-testid="selected-finger-hole-kind"]')?.textContent,
    ).toContain("Deep scoop");
    expect(container.querySelector('[aria-label="Diameter"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Total depth"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Reach"]')).toBeNull();
    expect(container.textContent).toContain("Vertical walls: 22.0 mm");
    expect(container.textContent).toContain("rounded bottom radius: 8.0 mm");

    React.act(() => {
      (container.querySelector('[data-testid="view-toggle-2d"]') as HTMLButtonElement).click();
    });
    expect(
      container.querySelector('[data-testid="finger-hole-deep-scoop-finger-deep"]'),
    ).not.toBeNull();
    unmount();
  });

  it("restores an oblong deep scoop with rotation controls and endpoint handles", async () => {
    const shape = rectangularShape("shape-oblong-deep", "Long pliers");
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT,
      shapes: [shape],
      cutouts: [
        parseCutoutPlacement({
          id: "cutout-oblong-deep",
          shapeId: shape.id,
          position: { x: 0, y: 0 },
        }),
      ],
      fingerHoles: [
        {
          id: "finger-oblong-deep",
          kind: "oblong-deep-scoop",
          center: { x: 0, y: 15 },
          diameterMm: 12,
          depthMm: 30,
          lengthMm: 40,
          rotationDeg: 0,
        },
      ],
    });

    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "finger-holes");
    React.act(() => {
      (
        container.querySelector(
          '[data-testid="button-select-finger-hole-finger-oblong-deep"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(
      container.querySelector('[data-testid="selected-finger-hole-kind"]')?.textContent,
    ).toContain("Oblong deep scoop");
    expect(container.querySelector('[aria-label="Diameter"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Total depth"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Length"]')).not.toBeNull();
    const rotateClockwise = container.querySelector(
      '[aria-label="Rotate oblong finger hole 90 degrees clockwise"]',
    ) as HTMLButtonElement;
    expect(rotateClockwise).not.toBeNull();
    expect(
      container.querySelector(
        '[aria-label="Rotate oblong finger hole 90 degrees counterclockwise"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain("Vertical walls: 24.0 mm");
    expect(container.textContent).toContain("rounded bottom radius: 6.0 mm");

    React.act(() => {
      (container.querySelector('[data-testid="view-toggle-2d"]') as HTMLButtonElement).click();
    });
    const handle = (endpoint: "start" | "end") =>
      container.querySelector(
        `[data-testid="finger-hole-oblong-end-${endpoint}-finger-oblong-deep"]`,
      ) as SVGCircleElement;
    expect(handle("start")).not.toBeNull();
    expect(handle("end")).not.toBeNull();
    expect(
      Math.abs(Number(handle("end").getAttribute("cx")) - Number(handle("start").getAttribute("cx"))),
    ).toBeGreaterThan(10);

    React.act(() => rotateClockwise.click());
    expect(
      Math.abs(Number(handle("end").getAttribute("cy")) - Number(handle("start").getAttribute("cy"))),
    ).toBeGreaterThan(10);
    unmount();
  });

  it("shows preview processing beside the size controls", () => {
    binGeometryMock.building = true;
    binGeometryMock.progress = 0.4;
    const { container, unmount } = renderPage();

    expect(
      container.querySelector('[data-testid="bin-size-preview-status"]')?.textContent,
    ).toContain("Updating 3D preview");
    expect(
      container.querySelector("#bin-settings-export")?.textContent,
    ).toContain("Updating");
    unmount();
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
    expect(index?.textContent).toContain("Tool Cutouts");
    expect(index?.textContent).not.toContain("Color by purpose");

    const expectedSections = [
      ["bin-settings-project", "slate", "closed"],
      ["bin-settings-size", "blue", "open"],
      ["bin-settings-construction", "rose", "closed"],
      ["bin-settings-pockets", "violet", "closed"],
      ["bin-settings-finger-holes", "cyan", "closed"],
      ["bin-settings-view", "amber", "closed"],
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
    expect(new Set(tones).size).toBe(tones.length);

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

  it("lets the user toggle pocket-floor coloring without rebuilding geometry", () => {
    binGeometryMock.hasPocketFloor = true;
    const { container, unmount } = renderPage();

    const viewport = container.querySelector('[data-testid="bin-viewport-stub"]');
    expect(viewport?.getAttribute("data-pocket-floor-color")).toBe("on");

    React.act(() => {
      (
        container.querySelector(
          '[data-testid="bin-settings-jump-view"]',
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

  it("shows compact color swatches and configurable downward material depths", () => {
    binGeometryMock.hasPocketFloor = true;
    const { container, unmount } = renderPage();
    React.act(() => {
      (
        container.querySelector(
          '[data-testid="bin-settings-jump-view"]',
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
    expect(container.textContent).toContain("never adds height to the bin");

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

  it("explains the empty Layout and keeps both rulers unavailable", () => {
    const { container, unmount } = renderPage();
    const ruler3d = container.querySelector(
      '[data-testid="button-3d-ruler"]',
    ) as HTMLButtonElement;
    expect(ruler3d).not.toBeNull();
    expect(ruler3d.disabled).toBe(true);
    expect(container.querySelector('[data-testid="button-layout-ruler"]')).toBeNull();

    React.act(() => {
      (
        container.querySelector('[data-testid="view-toggle-2d"]') as HTMLButtonElement
      ).click();
    });
    const ruler = container.querySelector(
      '[data-testid="button-layout-ruler"]',
    ) as HTMLButtonElement;
    expect(ruler).not.toBeNull();
    expect(ruler.getAttribute("aria-pressed")).toBe("false");
    expect(ruler.disabled).toBe(true);
    expect(ruler.title).toContain("Add a tool cutout");
    expect(
      container.querySelector('[data-testid="layout-empty-state"]')?.textContent,
    ).toContain("Add a tool pocket or a finger hole");
    expect(container.querySelector('[data-testid="layout-ruler-status"]')).toBeNull();
    expect(container.textContent).toContain("Add a tool pocket or finger hole to begin");
    unmount();
  });

  it("makes autosave/resume, save, open, and new-project paths explicit", async () => {
    const { container, unmount } = renderPage();
    openSettingsSection(container, "project");
    const status = container.querySelector(
      '[data-testid="project-autosave-status"]',
    ) as HTMLElement;
    const save = container.querySelector(
      '[data-testid="button-save-library"]',
    ) as HTMLButtonElement;
    const open = container.querySelector(
      '[data-testid="button-open-library"]',
    ) as HTMLButtonElement;
    const fresh = container.querySelector(
      '[data-testid="button-new-project"]',
    ) as HTMLButtonElement;

    expect(status.textContent).toContain("Checking for saved projects");
    expect(save.disabled).toBe(true);
    await flushHydration();

    expect(status.textContent).toContain("Untitled project");
    expect(status.textContent).toContain("draft resumes automatically");
    expect(save.textContent).toContain("Save to library");
    expect(open.textContent).toContain("Open library");
    expect(fresh.textContent).toContain("New project");
    expect(save.disabled).toBe(false);
    expect(open.disabled).toBe(false);
    expect(fresh.disabled).toBe(false);
    unmount();
  });

  it("names the current draft in the cross-browser Project Library", async () => {
    const { container, unmount } = renderPage();
    openSettingsSection(container, "project");
    await flushHydration();

    React.act(() => {
      (
        container.querySelector(
          '[data-testid="button-save-library"]',
        ) as HTMLButtonElement
      ).click();
    });
    const name = document.querySelector(
      '[data-testid="input-project-name"]',
    ) as HTMLInputElement;
    React.act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        name,
        "Socket wrench tray",
      );
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await React.act(async () => {
      (
        document.querySelector(
          '[data-testid="button-confirm-save-library"]',
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });

    expect(ProjectPersistence.saveProjectToLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ schemaVersion: PROJECT_SCHEMA_VERSION }),
      "Socket wrench tray",
      null,
    );
    expect(
      container.querySelector('[data-testid="project-autosave-status"]')?.textContent,
    ).toContain("Socket wrench tray");
    expect(
      container.querySelector('[data-testid="button-save-library"]')?.textContent,
    ).toContain("Rename");
    unmount();
  });

  it("lists named projects and opens the selected library entry", async () => {
    const projects = [
      { id: "project-1", name: "Socket tray", updatedAt: "2026-08-24T12:00:00.000Z" },
      { id: "project-2", name: "Pliers tray", updatedAt: "2026-08-24T13:00:00.000Z" },
    ];
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({
      activeProjectId: "project-1",
      projects,
    });
    vi.mocked(ProjectPersistence.openProjectFromLibrary).mockResolvedValue({
      doc: EMPTY_PROJECT,
      project: projects[1],
      library: { activeProjectId: "project-2", projects },
    });

    const { container, unmount } = renderPage();
    openSettingsSection(container, "project");
    await flushHydration();
    expect(
      container.querySelector('[data-testid="project-autosave-status"]')?.textContent,
    ).toContain("Socket tray");

    React.act(() => {
      (
        container.querySelector(
          '[data-testid="button-open-library"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(document.querySelector('[data-testid="project-list"]')?.textContent).toContain(
      "Pliers tray",
    );
    expect(
      (document.querySelector(
        '[data-testid="button-open-project-project-1"]',
      ) as HTMLButtonElement).disabled,
    ).toBe(true);

    await React.act(async () => {
      (
        document.querySelector(
          '[data-testid="button-open-project-project-2"]',
        ) as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });
    expect(ProjectPersistence.openProjectFromLibrary).toHaveBeenCalledWith("project-2");
    expect(
      container.querySelector('[data-testid="project-autosave-status"]')?.textContent,
    ).toContain("Pliers tray");
    unmount();
  });

  it("starts a fresh project only after confirmation and replaces the autosave", async () => {
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
    openSettingsSection(container, "project");
    await flushHydration();
    React.act(() =>
      libraryHandle!.addShape({
        id: "shape-to-clear",
        name: "saved wrench",
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
    expect(container.textContent).toContain("saved wrench");

    React.act(() => {
      (
        container.querySelector(
          '[data-testid="button-new-project"]',
        ) as HTMLButtonElement
      ).click();
    });
    const confirm = document.querySelector(
      '[data-testid="button-confirm-new-project"]',
    ) as HTMLButtonElement | null;
    expect(confirm).not.toBeNull();
    expect(container.textContent).toContain("saved wrench");

    await React.act(async () => {
      confirm!.click();
      await Promise.resolve();
    });

    expect(libraryHandle!.shapes).toEqual([]);
    expect(container.textContent).not.toContain("saved wrench");
    expect(ProjectPersistence.startNewProject).toHaveBeenLastCalledWith(
      expect.objectContaining({
        schemaVersion: PROJECT_SCHEMA_VERSION,
        shapes: [],
        cutouts: [],
        spec: expect.objectContaining({ gridX: 2, gridY: 2, heightUnits: 6 }),
      }),
    );
    expect(
      (container.querySelector('[data-testid="button-bin-undo"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    unmount();
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
    expect(text).toContain("Fit bin to contents");
    expect(text).toContain("Select a tool contour to edit it.");
    expect(text).toContain("click the tool name itself to rename it");
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
    expect(text).toContain("Added after the Trace margin");
    expect(text).toContain("Outline corner round");
    expect(text).toContain("Top edge round");
    expect(text).toContain("Bottom fillet");
    expect(text).toContain("Finger Holes");
    const renameButton = container.querySelector(
      '[data-testid="button-edit-shape-name"]',
    ) as HTMLButtonElement;
    const selectedRow = renameButton.closest('[data-testid^="cutout-row-"]');
    expect(selectedRow).not.toBeNull();
    expect(selectedRow!.textContent).toContain("Selected");
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
      "Bench wrench",
    );
    expect(container.textContent).toContain("Bench wrench");

    openSettingsSection(container, "export");
    expect(container.textContent).toContain("Final printable model");
    expect(container.textContent).toContain("Preview & layout checks");
    expect(container.textContent).toContain("Complete surface fit test");
    expect(container.textContent).toContain("Save surface fit test STL");
    expect(
      (
        container.querySelector(
          '[data-testid="input-surface-fit-test-thickness"]',
        ) as HTMLInputElement
      ).value,
    ).toBe("1.2");
    expect(
      (
        container.querySelector(
          '[data-testid="button-export-surface-fit-test"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(container.textContent).toContain("Tool fit template");
    expect(container.textContent).toContain("Save fit template STL");
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
      "Separate pocket floors (0.6 mm down) and rim top (1.25 mm down) for slicer assignment.",
    );
    const exportDialog = document.querySelector('[role="dialog"]') as HTMLElement;
    React.act(() => {
      (
        [...exportDialog.querySelectorAll("button")].find(
          (button) => button.textContent === "Cancel",
        ) as HTMLButtonElement
      ).click();
    });

    // Finger holes live in their own object list and selection context.
    openSettingsSection(container, "finger-holes");
    const addFingerHole = container.querySelector(
      '[data-testid="button-add-finger-hole"]',
    ) as HTMLButtonElement;
    React.act(() => addFingerHole.click());
    const kind = container.querySelector(
      '[data-testid="selected-finger-hole-kind"]',
    ) as HTMLButtonElement | null;
    expect(kind).not.toBeNull();
    expect(kind!.textContent).toContain("Straight");
    expect(container.textContent).not.toContain("Scoop depth");

    React.act(() => {
      (container.querySelector('[data-testid="view-toggle-2d"]') as HTMLButtonElement).click();
    });
    expect(container.querySelector('[data-testid^="finger-hole-straight-"]')).not.toBeNull();
    expect(container.querySelector('[data-testid^="finger-hole-width-"]')).not.toBeNull();

    // Selecting the pocket again is independent and exposes contour editing.
    openSettingsSection(container, "tool-cutouts");
    React.act(() => {
      (
        container.querySelector('[data-testid^="button-select-"]') as HTMLButtonElement
      ).click();
    });
    expect(
      container.querySelectorAll('[data-testid^="pocket-resize-handle-"]'),
    ).toHaveLength(8);
    expect(container.querySelector('[data-testid="pocket-rotate-handle"]')).not.toBeNull();
    const editContour = container.querySelector(
      '[data-testid="button-edit-contour"]',
    ) as HTMLButtonElement;
    React.act(() => editContour.click());
    expect(editContour.textContent).toContain("Finish contour editing");
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
    expect(container.querySelector('[data-testid^="finger-hole-straight-"]')).not.toBeNull();
    expect(container.querySelector("[data-rotate-handle]")).toBeNull();

    React.act(() => {
      container
        .querySelector('[data-testid="contour-vertex-handle"]')!
        .dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
        );
    });
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
    const removeButtons = container.querySelectorAll<HTMLButtonElement>(
      '[data-testid^="button-remove-"]',
    );
    expect(removeButtons).toHaveLength(2);

    React.act(() => removeButtons[0].click());
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

  it("shows build stats and enabled export buttons, viewport stubbed in", () => {
    const { container, unmount } = renderPage();
    openSettingsSection(container, "export");
    const text = container.textContent ?? "";

    expect(text).toContain("8,400 triangles");
    expect(text).toContain("82.4 cm³");
    expect(
      container.querySelector("#bin-settings-export [data-panel-section-trigger]")
        ?.textContent,
    ).toContain("No cutouts");
    expect(
      container.querySelector('[data-testid="export-no-cutouts-warning"]')
        ?.textContent,
    ).toContain("solid bin");
    expect(
      container.querySelector('[data-testid="export-preview-empty"]')?.textContent,
    ).toContain("Add a tool cutout");
    expect(
      container.querySelector('[data-testid="button-go-to-trace"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="bin-viewport-stub"]')).not.toBeNull();

    const export3mf = container.querySelector(
      '[data-testid="button-export-3mf"]',
    ) as HTMLButtonElement | null;
    expect(export3mf).not.toBeNull();
    expect(export3mf!.disabled).toBe(false);
    expect(
      (container.querySelector('[data-testid="button-export-stl"]') as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    unmount();
  });

  it("counts only color regions that exist in the current model", () => {
    const { container, unmount } = renderPage();
    React.act(() => {
      (
        container.querySelector(
          '[data-testid="bin-settings-jump-view"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(
      container.querySelector("#bin-settings-view [data-panel-section-trigger]")
        ?.textContent,
    ).toContain("2 colors");
    unmount();
  });

  it("asks about 3MF colors and warns before discarding them in STL", () => {
    const { container, unmount } = renderPage();
    openSettingsSection(container, "export");

    React.act(() => {
      (
        container.querySelector(
          '[data-testid="button-export-3mf"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(document.body.textContent).toContain(
      "Include multiple colors in the 3MF?",
    );
    expect(
      document.querySelector('[data-testid="button-export-single-color-3mf"]'),
    ).not.toBeNull();
    expect(
      (
        document.querySelector(
          '[data-testid="button-export-multicolor-3mf"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(false);

    React.act(() => {
      (
        container.querySelector(
          '[data-testid="button-export-stl"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(document.body.textContent).toContain("STL will not include your colors");
    expect(
      document.querySelector('[data-testid="button-confirm-stl-without-colors"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toContain("Use 3MF");
    unmount();
  });
});
