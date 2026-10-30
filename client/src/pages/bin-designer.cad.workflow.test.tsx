// @vitest-environment jsdom
import { EMPTY_PROJECT, binGeometryMock, renderPage, flushHydration, openSettingsSection } from "./bin-designer.test-support";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { strFromU8, strToU8, zipSync, unzipSync } from "fflate";
import * as ProjectPersistence from "@/lib/project/persist";
import { downloadBlob } from "@/lib/download";
import { exportStepInBrowser } from "@/lib/cad/client";
import type { StepExportReport } from "@/lib/cad/package";
import { createBasicPocket } from "@/lib/gridfinity/basic-shape";
import { parseProjectDoc } from "@shared/gridfinity/project";
import { parseBinSpec } from "@shared/gridfinity/types";

vi.mock("@/lib/cad/client", () => ({ exportStepInBrowser: vi.fn() }));

describe("STEP CAD packages", () => {
  it.each([
    { layout: "standard", mobile: false }, { layout: "workflow", mobile: false }, { layout: "workflow", mobile: true },
  ])("sends a committed project to the CAD worker without a printing mesh build: %j", async ({ layout, mobile }) => {
    const originalUrl = window.location.href;
    window.history.replaceState(null, "", `/bin?layout=${layout}`);
    const pocket = createBasicPocket("circle", { x: 0, y: 0 }, { x: 6, y: 0 }, "cad-circle")!;
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({
      ...EMPTY_PROJECT, name: "CAD tray", shapes: [pocket.shape], cutouts: [pocket.cutout],
      spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 4, flatBottom: true, lip: "none" }),
    });
    vi.mocked(exportStepInBrowser).mockImplementation(async project => ({bytes:zipSync({"design.pocketry.json":strToU8(JSON.stringify(project))}),report:{} as StepExportReport}));
    const { container, unmount } = renderPage({ mobile });
    try {
      await flushHydration();
      if (mobile) React.act(() => [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "Export")!.click());
      else openSettingsSection(container, "export");
      const button = document.querySelector<HTMLButtonElement>('[data-testid="button-export-step"]')!;
      expect(button.disabled).toBe(false);
      expect(document.querySelector('[data-testid="step-unavailable-reason"]')).toBeNull();
      binGeometryMock.buildOnce.mockClear();
      await React.act(async () => { button.click(); await Promise.resolve(); });
      expect(binGeometryMock.buildOnce).not.toHaveBeenCalled();
      const [blob, filename] = vi.mocked(downloadBlob).mock.lastCall!;
      expect(blob.type).toBe("application/zip"); expect(filename).toMatch(/-cad\.zip$/);
      const bytes = await new Promise<ArrayBuffer>((resolve) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.readAsArrayBuffer(blob);
      });
      const files = unzipSync(new Uint8Array(bytes));
      expect(exportStepInBrowser).toHaveBeenCalledOnce();
      expect(vi.mocked(exportStepInBrowser).mock.lastCall?.[1]?.signal).toBeInstanceOf(AbortSignal);
      expect(parseProjectDoc(JSON.parse(strFromU8(files["design.pocketry.json"])))?.cutouts[0]).toEqual(pocket.cutout);
    } finally { unmount(); window.history.replaceState(null, "", originalUrl); }
  });

  it("disables unsupported designs with a concrete reason and preserves existing export formats", async () => {
    vi.mocked(ProjectPersistence.loadProjectDoc).mockResolvedValue({...EMPTY_PROJECT,spec:parseBinSpec({...EMPTY_PROJECT.spec,magnetHoles:true})});
    const { container, unmount } = renderPage();
    try {
      await flushHydration(); openSettingsSection(container, "export");
      const button = container.querySelector<HTMLButtonElement>('[data-testid="button-export-step"]')!;
      expect(button.disabled).toBe(true);
      expect(container.querySelector('[data-testid="step-unavailable-reason"]')?.textContent).toContain("Hardware tools");
      React.act(() => button.click());
      expect(downloadBlob).not.toHaveBeenCalled();
      expect(container.querySelector<HTMLButtonElement>('[data-testid="button-export-stl"]')!.disabled).toBe(false);
      expect(container.querySelector<HTMLButtonElement>('[data-testid="button-export-3mf"]')!.disabled).toBe(false);
    } finally { unmount(); }
  });
});
