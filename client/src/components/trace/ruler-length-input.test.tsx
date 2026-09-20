// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TraceProvider, useTrace, type TraceStore } from "@/state/trace-store";
import { RulerLengthInput } from "./ruler-length-input";

let trace: TraceStore;
let host: HTMLDivElement;
let root: Root;
function Harness({ surface }: { surface: string }): JSX.Element {
  trace = useTrace();
  return <RulerLengthInput key={surface} id={`${surface}-length`} />;
}
const render = (surface: string) => React.act(() => root.render(<TraceProvider><Harness surface={surface} /></TraceProvider>));
const input = () => host.querySelector<HTMLInputElement>("input")!;
const type = (value: string) => React.act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
  input().dispatchEvent(new Event("input", { bubbles: true }));
});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  render("desktop");
  React.act(() => {
    trace.dispatch({ type: "SOURCE_LOADED", imageUrl: "photo", fileName: "tool" });
    trace.dispatch({ type: "SET_DRAFT_CALIBRATION", draftCalibration: { startX: 0, startY: 0, endX: 100, endY: 0 } });
  });
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it("keeps an unconfirmed length across desktop/mobile remounts, then confirms with Enter", () => {
  type("182.5");
  React.act(() => input().blur());
  expect(trace.calibration).toBeNull();
  render("mobile");
  expect(input().value).toBe("182.5");
  expect(trace.calibration).toBeNull();
  render("landscape");
  expect(input().value).toBe("182.5");
  React.act(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(trace.calibration?.lengthMm).toBe(182.5);
  expect(trace.rulerLengthMm).toBe(182.5);
});
it.each(["", "0", "-5"])("rejects invalid length %s without replacing the accepted scale", value => {
  React.act(() => trace.dispatch({ type: "SET_CALIBRATION", calibration: { startX: 0, startY: 0, endX: 100, endY: 0, lengthMm: 50 } }));
  type(value);
  expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
  expect(input().getAttribute("aria-invalid")).toBe("true");
  React.act(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(trace.calibration?.lengthMm).toBe(50);
});
it("accepts positive fractional millimetres using the same button as mobile", () => {
  type("0.05");
  expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
  React.act(() => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(trace.calibration?.lengthMm).toBe(0.05);
});
