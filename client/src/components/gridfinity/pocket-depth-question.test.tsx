import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseBinSpec } from "@shared/gridfinity/types";
import { PocketDepthQuestion } from "./pocket-depth-question";

let root: Root, host: HTMLDivElement;
const save = vi.fn(), later = vi.fn();
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function render(flatBottom = false, count = 1) {
  React.act(() => root.render(<PocketDepthQuestion spec={parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "solid", flatBottom })} name="Tool 1" count={count} onSave={save} onLater={later} />));
}
function button(label: string) { return [...host.querySelectorAll("button")].find(button => button.textContent === label)!; }
function enter(value: string) { React.act(() => { const input = host.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }

it("starts blank, keeps extra options collapsed, and lets the user defer without a guessed depth", () => {
  render();
  expect(button("Done").disabled).toBe(true);
  expect(host.querySelector("details")!.open).toBe(false);
  React.act(() => button("Set later").click());
  expect(later).toHaveBeenCalledOnce(); expect(save).not.toHaveBeenCalled();
});
it.each(["", "0", "-1", "0.5", "121", "Infinity", "nope"])("rejects invalid or too deep input: %s", value => {
  render(); enter(value); React.act(() => button("Done").click()); expect(save).not.toHaveBeenCalled();
});
it("accepts decimal commas and makes applying to all an explicit choice", () => {
  render(false, 3); enter("7,5");
  React.act(() => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  React.act(() => button("Done").click());
  expect(save).toHaveBeenCalledWith({ mode: "mm", value: 7.5 }, true);
});
it.each([false, true])("uses the destination's actual floor: flat bottom %s", flatBottom => {
  render(flatBottom);
  React.act(() => button("To bin floor").click());
  expect(host.textContent).toContain(`Keeps a ${flatBottom ? 2 : 7} mm floor`);
  React.act(() => button("Done").click());
  expect(save).toHaveBeenCalledWith({ mode: "remaining", floorThicknessMm: flatBottom ? 2 : 7 }, false);
});
it("explains through only when selected and retains the fixed-depth draft", () => {
  render(); enter("8");
  expect(host.textContent).not.toContain("surface underneath must support");
  React.act(() => button("Through — no bottom").click());
  expect(host.textContent).toContain("surface underneath must support");
  React.act(() => button("Fixed depth").click());
  expect(host.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!.value).toBe("8");
  React.act(() => button("Through — no bottom").click()); React.act(() => button("Done").click());
  expect(save).toHaveBeenCalledWith({ mode: "through" }, false);
});
