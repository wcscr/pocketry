import {
  binGeometryMock,
  EMPTY_PROJECT,
  rectangularShape,
  flushHydration,
  renderPage,
  openSettingsSection,
  selectPocket,
} from "./bin-designer.test-support";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { parseProjectDoc, type ProjectDoc } from "@shared/gridfinity/project";
import { DEFAULT_BIN_MATERIALS } from "@shared/gridfinity/materials";
import { fingerHoleSchema, parseCutoutPlacement } from "@shared/gridfinity/cutout";
import { parseBinSpec } from "@shared/gridfinity/types";
import { downloadBlob } from "@/lib/download";
import { useBinGeometry } from "@/lib/gridfinity/use-bin-geometry";
import * as ProjectPersistence from "@/lib/project/persist";

describe("BinDesignerPage", () => {

  it.each(["stl", "3mf"])("cancels %s without downloads and resets the JSON checkbox for the next request", async (format) => {
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "export");
    const trigger = container.querySelector<HTMLButtonElement>(`[data-testid="button-export-${format}"]`)!;
    React.act(() => trigger.click());
    const checkbox = () => document.querySelector<HTMLButtonElement>('[data-testid="checkbox-export-project"]')!;
    expect(checkbox().getAttribute("aria-checked")).toBe("false");
    React.act(() => checkbox().click());
    expect(checkbox().getAttribute("aria-checked")).toBe("true");
    React.act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === "Cancel")!.click());
    expect(document.querySelector('[data-testid="checkbox-export-project"]')).toBeNull();
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(binGeometryMock.buildOnce).not.toHaveBeenCalled();
    React.act(() => trigger.click());
    expect(checkbox().getAttribute("aria-checked")).toBe("false");
    unmount();
  });

  it.each(["button-show-full-bin", "button-inspect-pocket"])(
    "exits pocket inspection from %s and restores the full preview without editing the model",
    async (exitButton) => {
      const shape = rectangularShape("tool", "Wrench");
      vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
        ...EMPTY_PROJECT,
        shapes: [shape],
        cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, position: { x: 12, y: 0 } })],
      });
      const { container, unmount } = renderPage();
      await flushHydration();
      openSettingsSection(container, "tool-cutouts");
      React.act(() => {
        selectPocket(container, "pocket");
        container.querySelector<HTMLButtonElement>('[data-testid="view-toggle-2d"]')!.click();
      });
      const precision = container.querySelector<HTMLDetailsElement>('[aria-label="X position in millimetres"]')!.closest("details")!;
      expect(precision.open).toBe(false);
      expect(container.querySelector('[data-testid="button-show-full-bin"]')).toBeNull();
      const before = vi.mocked(useBinGeometry).mock.lastCall!;
      React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-inspect-pocket"]')!.click());
      expect(container.querySelector('[data-testid="bin-viewport-stub"]')).not.toBeNull();
      expect(vi.mocked(useBinGeometry).mock.lastCall![3]).toEqual({ axis: "x", offsetMm: 12 });
      expect(container.querySelector('[data-testid="button-inspect-pocket"]')!.textContent).toBe("Show full bin");
      const outlines = container.querySelector<HTMLButtonElement>('#hide-inspection-pocket-outline')!;
      expect(container.querySelector('label[for="hide-inspection-pocket-outline"]')!.textContent).toBe('Hide pocket outline');
      expect(outlines.getAttribute('aria-checked')).toBe('false');
      expect(container.querySelector('[data-testid="bin-viewport-stub"]')!.getAttribute('data-pocket-outlines')).toBe('on');
      const inspected = vi.mocked(useBinGeometry).mock.lastCall!;
      React.act(() => outlines.click());
      expect(outlines.getAttribute('aria-checked')).toBe('true');
      expect(container.querySelector('[data-testid="bin-viewport-stub"]')!.getAttribute('data-pocket-outlines')).toBe('off');
      expect(vi.mocked(useBinGeometry).mock.lastCall![3]).toBe(inspected[3]);
      React.act(() => outlines.click());
      expect(container.querySelector('[data-testid="bin-viewport-stub"]')!.getAttribute('data-pocket-outlines')).toBe('on');
      React.act(() => outlines.click());
      expect(container.querySelector('[data-testid="bin-viewport-stub"]')!.getAttribute('data-pocket-outlines')).toBe('off');
      React.act(() => container.querySelector<HTMLButtonElement>(`[data-testid="${exitButton}"]`)!.click());
      const after = vi.mocked(useBinGeometry).mock.lastCall!;
      expect(after[3]).toBeNull();
      expect(after[0]).toBe(before[0]);
      expect(after[2]).toBe(before[2]);
      expect(container.querySelector('[data-testid="button-show-full-bin"]')).toBeNull();
      expect(container.querySelector('[data-testid="button-inspect-pocket"]')!.textContent).toBe("Inspect this pocket in 3D");
      expect(container.querySelector('[data-testid="bin-viewport-stub"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="bin-viewport-stub"]')!.getAttribute('data-pocket-outlines')).toBe('on');
      expect(container.querySelector('#hide-inspection-pocket-outline')).toBeNull();
      unmount();
    },
  );

  it.each(['standard', 'workflow'])("ends pocket inspection when leaving its context in the %s layout", async layout => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, '', `/bin?layout=${layout}`);
    const shape = rectangularShape('inspect-tool', 'Tool');
    const cutouts = [0, 1].map(i => parseCutoutPlacement({ id: `inspect-${i}`, shapeId: shape.id, position: { x: i * 20, y: 4 } }));
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({ ...EMPTY_PROJECT, shapes: [shape], cutouts });
    const { container, unmount } = renderPage();
    try {
      await flushHydration();
      const click = (testId: string) => React.act(() => container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!.click());
      for (const leave of [
        () => click('button-clear-3d-selection'),
        () => selectPocket(container, cutouts[1].id),
        () => openSettingsSection(container, 'size'),
        () => click('view-toggle-2d'),
      ]) {
        openSettingsSection(container, 'tool-cutouts');
        selectPocket(container, cutouts[0].id);
        click('button-inspect-pocket');
        expect(vi.mocked(useBinGeometry).mock.lastCall![3]).toEqual({ axis: 'x', offsetMm: 0 });
        leave();
        expect(vi.mocked(useBinGeometry).mock.lastCall![3]).toBeNull();
        expect(container.querySelector('[data-testid="button-show-full-bin"]')).toBeNull();
        expect(vi.mocked(useBinGeometry).mock.lastCall![2]!.cutouts).toEqual(cutouts);
        expect(container.querySelector<HTMLButtonElement>('[data-testid="button-bin-undo"]')!.disabled).toBe(true);
      }
      // A general cross-section remains useful while browsing different pockets.
      openSettingsSection(container, 'check-fit');
      const group = document.querySelector<HTMLDetailsElement>('[data-testid="cross-section-settings"]')!;
      React.act(() => { group.open = true; group.querySelector<HTMLButtonElement>('[role="switch"]')!.click(); });
      openSettingsSection(container, 'tool-cutouts');
      selectPocket(container, cutouts[1].id);
      expect(vi.mocked(useBinGeometry).mock.lastCall![3]).toEqual({ axis: 'x', offsetMm: 0 });
    } finally { unmount(); window.history.replaceState(null, '', originalUrl); }
  });

  it.each([
    ["stl", "", "stl"],
    ["single-color-3mf", "", "3mf"],
    ["multicolor-3mf", "-multicolor", "3mf"],
    ["surface-fit-test", "-surface-fit-test-0.8mm", "stl"],
    ["surface-outline", "-tool-outlines-5mm-wide-0.8mm-thick", "stl"],
    ["fit-check", "-Left-wrench-fit-template-2mm", "stl"],
    ["layout-svg", "-layout", "svg"],
    ["layout-dxf", "-layout", "dxf"],
  ].flatMap(([kind, suffix, extension]) => [false, true].map((includeProject) => ({ kind, suffix, extension, includeProject }))))(
    "exports $kind with project JSON only when requested ($includeProject)",
    async ({ kind, suffix, extension, includeProject }) => {
    const shape = rectangularShape("tool", "Wrench");
    const project: ProjectDoc = {
      ...EMPTY_PROJECT,
      spec: parseBinSpec({ gridX: 4, gridY: 4, heightUnits: 6.5 }),
      shapes: [shape, rectangularShape("unused", "Unplaced tool")],
      cutouts: [parseCutoutPlacement({ id: "pocket", shapeId: shape.id, name: "Left wrench", position: { x: 0, y: 0 } })],
      fingerHoles: [fingerHoleSchema.parse({ id: "hole", kind: "straight", center: { x: 40, y: 0 } })],
    };
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue(project);
    vi.mocked(ProjectPersistence.loadProjectLibrary).mockResolvedValue({
      activeProjectId: "layout-2",
      projects: [{ id: "layout-2", name: "Layout 2", updatedAt: "2026-09-05T12:00:00Z" }],
    });
    const mesh = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
      indices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
      normals: null,
    };
    const result = { mesh, materialMeshes: { body: mesh, pocketFloors: mesh, stackingRim: mesh } };
    binGeometryMock.buildOnce.mockResolvedValue(result);
    binGeometryMock.buildFitCheck.mockResolvedValue(result);
    binGeometryMock.buildSurfaceFitCheck.mockResolvedValue(result);
    const { container, unmount } = renderPage();
    await flushHydration();
    try {
      if (kind === "fit-check") {
        openSettingsSection(container, "tool-cutouts");
        React.act(() => {
          selectPocket(container, "pocket");
        });
      }
      openSettingsSection(container, kind.startsWith("surface-") || kind === "fit-check" ? "check-fit" : "export");
      if (kind === "surface-fit-test") {
        React.act(() => container.querySelector('[data-testid="select-surface-fit-test-style"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })));
        React.act(() => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === "Full surface")!.click());
      }
      await React.act(async () => {
        const button = kind === "surface-outline" ? "button-export-surface-fit-test"
          : kind.startsWith("layout-") ? `button-${kind}` : `button-export-${kind.endsWith("3mf") ? "3mf" : kind}`;
        container.querySelector<HTMLButtonElement>(`[data-testid="${button}"]`)!.click();
      });
      expect(downloadBlob).not.toHaveBeenCalled();
      const checkbox = document.querySelector<HTMLButtonElement>('[data-testid="checkbox-export-project"]')!;
      expect(checkbox.getAttribute("aria-checked")).toBe("false");
      if (includeProject) React.act(() => checkbox.click());
      await React.act(async () => {
        const button = kind.endsWith("3mf") ? `button-export-${kind}` : "button-confirm-export";
        document.querySelector<HTMLButtonElement>(`[data-testid="${button}"]`)!.click();
      });
      expect(downloadBlob).toHaveBeenCalledTimes(includeProject ? 2 : 1);
      if (kind.startsWith("surface-")) {
        expect(binGeometryMock.buildSurfaceFitCheck).toHaveBeenCalledWith(0.8, expect.any(Object), kind === "surface-outline" ? "outline" : "full");
      }
      const [model, modelName] = vi.mocked(downloadBlob).mock.calls.at(-1)!;
      expect(modelName).toMatch(new RegExp(`^Layout-2-bin-4x4x6\\.5${suffix.replaceAll(".", "\\.")}-\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2}-\\d{3}\\.${extension}$`));
      expect(model.size).toBeGreaterThan(84);
      if (!includeProject) return;
      const [backup, backupName] = vi.mocked(downloadBlob).mock.calls[0];
      expect(backupName).toBe(modelName.replace(/\.(stl|3mf|svg|dxf)$/, ".pocketry.json"));
      const json = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(backup);
      });
      expect(parseProjectDoc(JSON.parse(json))).toEqual({
        ...project, name: "Layout 2", keepBinSize: false, materials: DEFAULT_BIN_MATERIALS,
        transformOrigins: { pockets: project.cutouts.map(cutout => ({ cutout, spec: project.spec })), fingerHoles: project.fingerHoles },
        history: { index: 0, stack: [{ label: "Project opened", doc: {
          spec: project.spec, cutouts: project.cutouts, fingerHoles: project.fingerHoles,
        } }] },
      });
    } finally {
      unmount();
    }
  });

  it("does not download an export pair when geometry generation fails", async () => {
    binGeometryMock.buildOnce.mockRejectedValueOnce(new Error("Mesh failed"));
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "export");
    React.act(() => container.querySelector<HTMLButtonElement>('[data-testid="button-export-stl"]')!.click());
    await React.act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="button-confirm-export"]')!.click();
    });
    expect(binGeometryMock.buildOnce).toHaveBeenCalledTimes(1);
    expect(downloadBlob).not.toHaveBeenCalled();
    unmount();
  });

  it.each([
    ["standard", "45.6"],
    ["none", "42.0"],
  ] as const)("shows the outer printed dimensions in STL and 3MF confirmations with %s lip", async (lip, height) => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT,
      spec: parseBinSpec({ ...EMPTY_PROJECT.spec, gridX: 2, gridY: 3, heightUnits: 6, lip }),
    });
    const { container, unmount } = renderPage();
    await flushHydration();
    openSettingsSection(container, "export");
    for (const format of ["3mf", "stl"]) {
      React.act(() => container.querySelector<HTMLButtonElement>(`[data-testid="button-export-${format}"]`)!.click());
      const dialog = document.querySelector('[role="dialog"]')!;
      expect(dialog.textContent).toContain(`Outer size: 83.5 × 125.5 × ${height} mm (width × length × height).`);
      if (format === "3mf") expect(document.activeElement).toBe(dialog.querySelector('h2'));
      React.act(() => [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "Cancel")!.click());
    }
    expect(binGeometryMock.buildOnce).not.toHaveBeenCalled();
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
      [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === "Cancel")!.click();
    });
    React.act(() => {
      (
        container.querySelector(
          '[data-testid="button-export-stl"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(document.body.textContent).toContain("STL will not include your colors");
    expect(
      document.querySelector('[data-testid="button-confirm-export"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toContain("Use multi-color 3MF");
    unmount();
  });});
