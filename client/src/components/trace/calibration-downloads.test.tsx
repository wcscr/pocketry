// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadCalibrationTemplate } from "@/lib/calibrate/download-template";
import { CalibrationDownloads } from "./calibration-downloads";

vi.mock("@/lib/calibrate/download-template", () => ({ downloadCalibrationTemplate: vi.fn() }));
vi.mock("@/lib/calibrate/download-reference-strip", () => ({ downloadMeasurementAid: vi.fn().mockResolvedValue(undefined) }));
const selected = vi.fn();
const detect = vi.fn();
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  React.act(() => root.render(<CalibrationDownloads onPaperSelected={selected} onDetectMarkers={detect} />));
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("calibration download dialog", () => {
  it("hides download details until requested and offers only current sheets and 3MF aids", async () => {
    expect(host.textContent).toBe("Paper sheets and 3D measurement aids:  Download templates");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await React.act(async () => host.querySelector("button")!.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Calibration templates");
    expect(dialog.textContent).toContain("Printable measurement aids");
    expect(dialog.textContent).not.toMatch(/STL|recessed|Paper reference strip/);
    expect(dialog.querySelector('[data-testid="button-template-a4"]')).toBeNull();
    expect(dialog.querySelector('[data-testid="button-template-letter"]')).toBeNull();
    for (const paper of ["a4", "letter"] as const) {
      await React.act(async () => dialog.querySelector<HTMLButtonElement>(`[data-testid="button-template-${paper}-experimental"]`)!.click());
      expect(downloadCalibrationTemplate).toHaveBeenLastCalledWith(`${paper}-experimental`);
      expect(selected).toHaveBeenLastCalledWith(paper);
    }
    expect(downloadCalibrationTemplate).toHaveBeenCalledTimes(2);
    await React.act(async () => dialog.querySelector<HTMLButtonElement>('[data-testid="button-detect-markers"]')!.click());
    expect(detect).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
