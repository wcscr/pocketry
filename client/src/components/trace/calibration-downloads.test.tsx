// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadCalibrationTemplate } from "@/lib/calibrate/download-template";
import { downloadMeasurementAid, downloadMeasurementAidsPdf } from "@/lib/calibrate/download-reference-strip";
import { CalibrationDownloads } from "./calibration-downloads";

vi.mock("@/lib/calibrate/download-template", () => ({ downloadCalibrationTemplate: vi.fn() }));
vi.mock("@/lib/calibrate/download-reference-strip", () => ({
  downloadMeasurementAid: vi.fn().mockResolvedValue(undefined),
  downloadMeasurementAidsPdf: vi.fn(),
}));
const selected = vi.fn();
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  React.act(() => root.render(<CalibrationDownloads onPaperSelected={selected} />));
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("calibration download dialog", () => {
  it("hides download details until requested and groups paper and 3MF downloads separately", async () => {
    expect(host.textContent).toBe("Download calibration aids");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await React.act(async () => host.querySelector("button")!.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Calibration aids");
    expect(dialog.textContent).toContain("3D printable aids");
    expect(dialog.querySelector('section[aria-label="Paper printable aids"]')?.textContent).toContain("Calibration sheets");
    expect(dialog.textContent).not.toMatch(/STL|recessed|Paper reference strip/);
    expect(dialog.querySelector('[data-testid="button-template-a4"]')).toBeNull();
    expect(dialog.querySelector('[data-testid="button-template-letter"]')).toBeNull();
    for (const paper of ["a4", "letter"] as const) {
      await React.act(async () => dialog.querySelector<HTMLButtonElement>(`[data-testid="button-template-${paper}-experimental"]`)!.click());
      expect(downloadCalibrationTemplate).toHaveBeenLastCalledWith(`${paper}-experimental`);
      expect(selected).toHaveBeenLastCalledWith(paper);
    }
    expect(downloadCalibrationTemplate).toHaveBeenCalledTimes(2);
    expect(dialog.querySelector('[data-testid="button-detect-markers"]')).toBeNull();
  });

  it("downloads all three aids on one sheet in either paper size without changing the perspective sheet", async () => {
    await React.act(async () => host.querySelector("button")!.click());
    const section = document.querySelector('section[aria-label="Paper printable aids"]')!;
    expect(section.textContent).toContain("50, 100 and 200 mm aids on one sheet");
    for (const paper of ["a4", "letter"] as const) {
      const label = `Download all three measurement aids as ${paper === "a4" ? "A4" : "US Letter"} PDF`;
      await React.act(async () => section.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
      expect(downloadMeasurementAidsPdf).toHaveBeenLastCalledWith(paper);
    }
    expect(downloadMeasurementAidsPdf).toHaveBeenCalledTimes(2);
    expect(selected).not.toHaveBeenCalled();
    expect(downloadCalibrationTemplate).not.toHaveBeenCalled();
    expect(downloadMeasurementAid).not.toHaveBeenCalled();
  });

  it("keeps all three 3MF downloads in the 3D section", async () => {
    await React.act(async () => host.querySelector("button")!.click());
    const section = document.querySelector('section[aria-label="3D printable aids"]')!;
    for (const length of [50, 100, 200] as const) {
      await React.act(async () => section.querySelector<HTMLButtonElement>(`[aria-label="Download ${length} mm measurement aid as 3MF"]`)!.click());
      expect(downloadMeasurementAid).toHaveBeenLastCalledWith(length);
    }
    expect(downloadMeasurementAid).toHaveBeenCalledTimes(3);
    expect(downloadMeasurementAidsPdf).not.toHaveBeenCalled();
  });
});
