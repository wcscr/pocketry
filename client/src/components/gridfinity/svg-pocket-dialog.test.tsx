import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { SvgPocketDialog } from "./svg-pocket-dialog";
import { parseBinSpec } from "@shared/gridfinity/types";

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), storeShape: vi.fn(), close: vi.fn() }));
vi.mock("@/state/bin-store", () => ({ useBin: () => ({ spec: parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6 }), dispatch: mocks.dispatch }) }));
vi.mock("@/state/shape-library", () => ({ useShapeLibrary: () => ({ storeShape: mocks.storeShape }) }));
let root: Root, host: HTMLDivElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function render() { React.act(() => root.render(<SvgPocketDialog onClose={mocks.close} />)); }
async function choose(text: string, name = "tool.svg") {
  const file = new File([text], name, { type: "image/svg+xml" });
  Object.defineProperty(file, "text", { value: () => Promise.resolve(text) });
  await React.act(async () => {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function type(index: number, value: string) {
  React.act(() => {
    const input = document.querySelectorAll<HTMLInputElement>('input:not([type="file"])')[index];
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function submit() { React.act(() => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }

it("imports physical SVG geometry with explicit depth into one placement action", async () => {
  render();
  await choose('<svg width="100mm" height="100mm" viewBox="0 0 100 100"><rect x="20" y="10" width="30" height="20"/></svg>');
  expect(document.body.textContent).toContain("30.00 × 20.00 mm");
  type(1, "12,45"); submit();
  const shape = mocks.storeShape.mock.calls[0][0];
  expect(shape.name).toBe("tool");
  expect(shape.bboxMm).toEqual({ minX: -15, minY: -10, maxX: 15, maxY: 10 });
  const actions = mocks.dispatch.mock.calls.map(([action]) => action);
  expect(actions.filter(action => action.type === "ADD_PLACED")).toHaveLength(1);
  expect(actions.find(action => action.type === "ADD_PLACED").cutouts[0]).toMatchObject({ shapeId: shape.id, position: { x: 0, y: 0 },
    depth: { mode: "mm", value: 12.45 }, cornerRoundMm: 0, topFilletMm: 0, bottomFilletMm: 0 });
  expect(actions.find(action => action.type === "SET_VIEW_MODE")).toMatchObject({ viewMode: "2d" });
  expect(mocks.close).toHaveBeenCalledOnce();
});

it("requires a width for unscaled artwork and permits a calibrated override", async () => {
  render();
  await choose('<svg viewBox="0 0 100 100"><rect x="20" y="10" width="30" height="20"/></svg>');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("physical");
  submit(); expect(mocks.storeShape).not.toHaveBeenCalled();
  type(0, "45");
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.body.textContent).toContain("45.00 × 30.00 mm");
  submit();
  expect(mocks.storeShape.mock.calls[0][0].bboxMm).toEqual({ minX: -22.5, minY: -15, maxX: 22.5, maxY: 15 });
});

it("reports open or referenced SVG geometry without changing the library", async () => {
  render(); await choose('<svg width="100mm"><path d="M0 0 L10 0 L10 10"/></svg>');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Open path");
  submit(); expect(mocks.storeShape).not.toHaveBeenCalled(); expect(mocks.dispatch).not.toHaveBeenCalled();
  await choose('<svg width="100mm"><image href="https://example.com/image.png"/></svg>');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("referenced");
});

it.each(["", "0", "-1", "Infinity", "43"])("rejects invalid pocket depth %s", async depth => {
  render(); await choose('<svg width="100mm" viewBox="0 0 100 100"><rect width="10" height="20"/></svg>');
  type(1, depth); submit(); expect(mocks.storeShape).not.toHaveBeenCalled(); expect(mocks.dispatch).not.toHaveBeenCalled();
});

it("cancel leaves the shape library untouched", async () => {
  render(); await choose('<svg width="100mm" viewBox="0 0 100 100"><rect width="10" height="20"/></svg>');
  React.act(() => [...document.querySelectorAll("button")].find(button => button.textContent === "Close")!.click());
  expect(mocks.close).toHaveBeenCalledOnce(); expect(mocks.storeShape).not.toHaveBeenCalled(); expect(mocks.dispatch).not.toHaveBeenCalled();
});

it("ignores stale reads when a different SVG is selected", async () => {
  render();
  let resolveFirst: (text: string) => void = () => {};
  const first = new File([""], "first.svg", { type: "image/svg+xml" });
  Object.defineProperty(first, "text", { value: () => new Promise<string>(resolve => { resolveFirst = resolve; }) });
  React.act(() => {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [first] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await choose('<svg width="100mm" viewBox="0 0 100 100"><rect width="30" height="20"/></svg>', "second.svg");
  await React.act(async () => { resolveFirst('<svg width="100mm" viewBox="0 0 100 100"><rect width="10" height="10"/></svg>'); });
  expect(document.body.textContent).toContain("30.00 × 20.00 mm");
  submit(); expect(mocks.storeShape.mock.calls[0][0].name).toBe("second");
});
