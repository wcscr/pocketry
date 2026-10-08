import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { initialTraceState, type TraceState } from "@/state/trace-store";
import { TraceHandoffDialog } from "./trace-handoff-dialog";

const mocks = vi.hoisted(() => ({ addShape: vi.fn(), close: vi.fn(), choosePhoto: vi.fn(), navigate: vi.fn(), destination: null as import("@/state/project-activity").ProjectActivity | null }));
vi.mock("@/state/project-activity", () => ({ useProjectActivity: () => mocks.destination }));
let trace: TraceState;
vi.mock("@/state/trace-store", async importOriginal => ({
  ...await importOriginal<typeof import("@/state/trace-store")>(), useTrace: () => trace,
}));
vi.mock("@/state/shape-library", () => ({ useShapeLibrary: () => ({ addShape: mocks.addShape }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/", mocks.navigate] }));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.destination = null;
  trace = { ...initialTraceState, fileName: "Wrench", imageSize: { width: 100, height: 100 },
    calibration: { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 50 },
    outline: [{ outer: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 30 }, { x: 10, y: 30 }], holes: [] }] };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function render() { React.act(() => root.render(<TraceHandoffDialog onClose={mocks.close} onChoosePhoto={mocks.choosePhoto} />)); }
function depth(index: number, value: string) {
  React.act(() => {
    const input = document.getElementById(`tool-depth-${index}`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function button(name: string) { return [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === name)!; }

it("requires an explicit depth, then hands off the chosen millimetres", () => {
  render();
  expect(button("Add and arrange").disabled).toBe(true);
  expect(button("Add and trace another photo").disabled).toBe(true);
  expect((document.getElementById("tool-depth-0") as HTMLInputElement).value).toBe("");
  depth(0, "7,5");
  React.act(() => button("Add and arrange").click());
  expect(mocks.addShape).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: "Wrench", sourceMmPerPx: 0.5 }), { mode: "mm", value: 7.5 }, undefined);
  expect(mocks.navigate).toHaveBeenCalledWith("/bin");
});

it.each(["saved", "loading", "error"] as const)("names the destination and respects its %s state", status => {
  mocks.destination = { name: "Wrench tray", activeProjectId: "wrenches", status, error: null, hasDocument: true };
  render(); depth(0, "8");
  expect(document.body.textContent).toContain("Destination: Wrench tray");
  expect(document.body.textContent).toContain("Later trace edits do not update pockets already added");
  expect(button("Add and arrange").disabled).toBe(status !== "saved");
});

it.each(["", "0", "-2", "0.5", "121", "Infinity", "nope"])("does not hand off an invalid depth: %s", value => {
  render(); depth(0, value);
  React.act(() => { button("Add and arrange").click(); button("Add and trace another photo").click(); });
  expect(mocks.addShape).not.toHaveBeenCalled();
  expect(mocks.close).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Choose a valid fixed depth, To Floor, or Through for every pocket");
});

it("allows an explicit through choice and requires depth again when fixed depth is selected", () => {
  render();
  React.act(() => document.getElementById("tool-through-0")!.click());
  expect(button("Add and arrange").disabled).toBe(false);
  expect(document.body.textContent).toContain("The work surface must support the tool");
  React.act(() => document.getElementById("tool-mm-0")!.click());
  expect(button("Add and arrange").disabled).toBe(true);
  React.act(() => document.getElementById("tool-through-0")!.click());
  React.act(() => button("Add and trace another photo").click());
  expect(mocks.addShape).toHaveBeenCalledExactlyOnceWith(expect.any(Object), { mode: "through" }, undefined);
  expect(mocks.choosePhoto).toHaveBeenCalledOnce();
  expect(mocks.navigate).not.toHaveBeenCalled();
});

it("hands off To Floor without a numeric depth, and preserves fixed input across mode changes", () => {
  render();
  React.act(() => document.getElementById("tool-to-floor-0")!.click());
  expect(button("Add and arrange").disabled).toBe(false);
  expect((document.getElementById("tool-depth-0") as HTMLInputElement).disabled).toBe(true);
  expect(document.body.textContent).toContain("7 mm above the underside for Gridfinity, or 2 mm for a flat-bottom bin");
  React.act(() => document.getElementById("tool-mm-0")!.click());
  expect(button("Add and arrange").disabled).toBe(true);
  depth(0, "8");
  React.act(() => document.getElementById("tool-to-floor-0")!.click());
  React.act(() => document.getElementById("tool-through-0")!.click());
  React.act(() => document.getElementById("tool-mm-0")!.click());
  expect((document.getElementById("tool-depth-0") as HTMLInputElement).value).toBe("8");
  expect(button("Add and arrange").disabled).toBe(false);
  React.act(() => document.getElementById("tool-to-floor-0")!.click());
  React.act(() => button("Add and arrange").click());
  expect(mocks.addShape).toHaveBeenCalledExactlyOnceWith(expect.any(Object), { mode: "to-floor" }, undefined);
});

it("keeps independent floor and through choices when separate pockets are regrouped", () => {
  trace = { ...trace, outline: [trace.outline[0], trace.outline[0]] };
  render();
  React.act(() => document.getElementById("tool-to-floor-0")!.click());
  expect(button("Add and arrange").disabled).toBe(true);
  React.act(() => document.getElementById("tool-through-1")!.click());
  React.act(() => document.getElementById("separate-tools")!.click());
  expect(document.getElementById("tool-to-floor-0")!.getAttribute("aria-checked")).toBe("true");
  React.act(() => document.getElementById("separate-tools")!.click());
  expect(document.getElementById("tool-through-1")!.getAttribute("aria-checked")).toBe("true");
  React.act(() => button("Add and arrange").click());
  expect(mocks.addShape.mock.calls.map(call => call[1])).toEqual([{ mode: "to-floor" }, { mode: "through" }]);
});

it("requires a choice for every separate tool and keeps choices when grouping is toggled", () => {
  trace = { ...trace, outline: [trace.outline[0], trace.outline[0]] };
  render(); depth(0, "5");
  expect(button("Add and arrange").disabled).toBe(true);
  React.act(() => document.getElementById("separate-tools")!.click());
  expect(button("Add and arrange").disabled).toBe(false);
  React.act(() => document.getElementById("separate-tools")!.click());
  expect(button("Add and arrange").disabled).toBe(true);
  depth(1, "9");
  React.act(() => button("Add and arrange").click());
  expect(mocks.addShape.mock.calls.map(call => call[1])).toEqual([{ mode: "mm", value: 5 }, { mode: "mm", value: 9 }]);
});

it("still blocks a pending scale replacement and leaves the queue untouched on cancel", () => {
  trace = { ...trace, mode: "calibrate" };
  render(); depth(0, "8");
  expect(button("Add and arrange").disabled).toBe(true);
  React.act(() => button("Close").click());
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(mocks.addShape).not.toHaveBeenCalled();
});
