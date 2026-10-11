import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { initialTraceState, type TraceState } from "@/state/trace-store";
import { TraceHandoffOptions, useTraceHandoff } from "./trace-handoff";

const mocks = vi.hoisted(() => ({ addShape: vi.fn(), navigate: vi.fn(), destination: null as import("@/state/project-activity").ProjectActivity | null }));
vi.mock("@/state/project-activity", () => ({ useProjectActivity: () => mocks.destination }));
let trace: TraceState;
vi.mock("@/state/trace-store", async importOriginal => ({
  ...await importOriginal<typeof import("@/state/trace-store")>(), useTrace: () => trace,
}));
vi.mock("@/state/shape-library", () => ({ useShapeLibrary: () => ({ shapes: [{ name: "Tool 1" }], addShape: mocks.addShape }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/", mocks.navigate] }));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks(); mocks.destination = null;
  trace = { ...initialTraceState, fileName: "20260919_101433", imageSize: { width: 100, height: 100 },
    calibration: { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 50 },
    outline: [{ outer: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 30 }, { x: 10, y: 30 }], holes: [] }] };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function Handoff() {
  const handoff = useTraceHandoff();
  return <><TraceHandoffOptions handoff={handoff} /><button disabled={!handoff.ready} onClick={handoff.addToBin}>Add to bin</button></>;
}
function render() { React.act(() => root.render(<Handoff />)); }
function add() { React.act(() => host.querySelector("button")!.click()); }

it("adds immediately with a readable unique name and explicitly unresolved depth", () => {
  render(); add(); add();
  expect(mocks.addShape).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: "Tool 2", sourceMmPerPx: 0.5 }), { mode: "unset" }, undefined);
  expect(mocks.navigate).toHaveBeenCalledWith("/bin");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it.each(["saved", "loading", "error"] as const)("shows the destination and respects its %s state", status => {
  mocks.destination = { name: "Wrench tray", activeProjectId: "wrenches", status, error: null, hasDocument: true };
  render(); add();
  expect(host.querySelector("button")!.disabled).toBe(status !== "saved");
  if (status === "saved") {
    expect(host.textContent).toContain("Adding to: Wrench tray");
    expect(mocks.addShape.mock.calls[0][2]).toEqual({ key: "project:wrenches", name: "Wrench tray" });
  } else expect(mocks.addShape).not.toHaveBeenCalled();
});

it.each([false, true])("keeps grouping optional: combined %s", combined => {
  trace = { ...trace, outline: [trace.outline[0], trace.outline[0]] };
  render();
  if (combined) React.act(() => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  add();
  expect(mocks.addShape).toHaveBeenCalledTimes(combined ? 1 : 2);
  expect(mocks.addShape.mock.calls.map(call => call[0].name)).toEqual(combined ? ["Tool 2"] : ["Tool 2", "Tool 3"]);
  expect(mocks.addShape.mock.calls.every(call => call[1].mode === "unset")).toBe(true);
});

it.each(["scale", "processing", "empty", "uncalibrated"])("retains the %s handoff guard", guard => {
  trace = { ...trace, ...(guard === "scale" ? { mode: "calibrate" as const }
    : guard === "processing" ? { processing: true } : guard === "empty" ? { outline: [] } : { calibration: null }) };
  render(); add();
  expect(mocks.addShape).not.toHaveBeenCalled();
});
