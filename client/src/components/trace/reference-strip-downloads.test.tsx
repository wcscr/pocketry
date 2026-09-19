// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReferenceStripDownloads } from "./reference-strip-downloads";
import { downloadMeasurementAid, downloadReferenceStripPdf } from "@/lib/calibrate/download-reference-strip";

vi.mock("@/lib/calibrate/download-reference-strip", () => ({ downloadMeasurementAid: vi.fn().mockResolvedValue(undefined), downloadReferenceStripPdf: vi.fn() }));
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  host = document.createElement("div"); document.body.appendChild(host);
  root = createRoot(host);
  React.act(() => root.render(<ReferenceStripDownloads />));
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const button = (text: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text)!;

describe("measurement-aid downloads", () => {
  it("downloads only the selected 50/100/200 mm aid in either format", async () => {
    expect(button("100 mm").getAttribute("aria-pressed")).toBe("true");
    for (const length of [50, 100, 200]) {
      await React.act(async () => button(`${length} mm`).click());
      expect(host.textContent).toContain(`${length} × 15 × 2 mm`);
      await React.act(async () => button("3MF · two colours").click());
      expect(downloadMeasurementAid).toHaveBeenLastCalledWith(length, "3mf");
      await React.act(async () => button("STL · recessed markings").click());
      expect(downloadMeasurementAid).toHaveBeenLastCalledWith(length, "stl");
    }
    expect(host.textContent).not.toContain("300 mm");
    expect(host.textContent).toContain("fill the recessed markers");
    await React.act(async () => button("Strip PDF · US Letter").click());
    expect(downloadReferenceStripPdf).toHaveBeenCalledWith("letter");
  });

  it("reports a failed mesh build and permits another download", async () => {
    vi.mocked(downloadMeasurementAid).mockRejectedValueOnce(new Error("Mesh build failed"));
    await React.act(async () => button("3MF · two colours").click());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Mesh build failed", variant: "destructive" }));
    expect(button("3MF · two colours").disabled).toBe(false);
  });
});
