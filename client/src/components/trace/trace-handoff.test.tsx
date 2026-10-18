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

it("adds immediately with a readable unique name and depth to the bin floor", () => {
  render(); add(); add();
  expect(mocks.addShape).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: "Tool 2", sourceMmPerPx: 0.5 }), { mode: "to-floor" }, undefined);
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
  expect(mocks.addShape.mock.calls.every(call => call[1].mode === "to-floor")).toBe(true);
});

it("queues photo-relative centres in millimetres with one Y flip for separate pockets", () => {
  const first = trace.outline[0];
  trace = { ...trace, outline: [first, { outer: first.outer.map(p => ({ x: p.x + 24, y: p.y + 12 })), holes: [] }] };
  render(); add();
  const [a, b] = mocks.addShape.mock.calls;
  expect(a[3].batchId).toBe(b[3].batchId);
  expect(b[3].center.x - a[3].center.x).toBe(12);
  expect(b[3].center.y - a[3].center.y).toBe(-6);
  expect(a[0].bboxMm).toEqual(b[0].bboxMm);
});

it.each(["scale", "processing", "empty", "uncalibrated"])("retains the %s handoff guard", guard => {
  trace = { ...trace, ...(guard === "scale" ? { mode: "calibrate" as const }
    : guard === "processing" ? { processing: true } : guard === "empty" ? { outline: [] } : { calibration: null }) };
  render(); add();
  expect(mocks.addShape).not.toHaveBeenCalled();
});

it.each([false, true])("keeps holes as independent objects with their photo position, combined=%s", combined => {
  const hole = [{ x: 25, y: 15 }, { x: 35, y: 15 }, { x: 35, y: 25 }, { x: 25, y: 25 }];
  trace = { ...trace, outline: [{ ...trace.outline[0], holes: [hole] }, { ...trace.outline[0], holes: [...[hole.map(p => ({ ...p }))].map(r => r.reverse())] }] };
  render();
  if (combined) React.act(() => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  add();
  const calls = mocks.addShape.mock.calls;
  expect(calls).toHaveLength(combined ? 2 : 3);
  const retained = calls.filter(call => call[3]?.role === "hole");
  expect(retained).toHaveLength(1);
  expect(retained[0][0].name).toBe("Hole 1");
  expect(retained[0][3]).toMatchObject({ batchId: calls[0][3].batchId, center: { x: 15, y: 40 }, role: "hole" });
  expect(calls.every(call => call[0].outlineMm.every((part: { holes: unknown[] }) => part.holes.length === 0))).toBe(true);
});
