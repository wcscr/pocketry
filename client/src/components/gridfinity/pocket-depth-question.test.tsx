import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseBinSpec } from "@shared/gridfinity/types";
import { PocketDepthQuestion } from "./pocket-depth-question";
import type { PendingPocketDepthDraft } from "@/state/bin-store";

let root: Root, host: HTMLDivElement;
const save = vi.fn(), later = vi.fn(), editHeight = vi.fn();
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function render(flatBottom = false, count = 1) {
  function Question() {
    const [draft, setDraft] = React.useState<PendingPocketDepthDraft>({ value: "", mode: "mm", all: false });
    return <PocketDepthQuestion spec={parseBinSpec({ gridX: 2, gridY: 2, heightUnits: 6, fill: "solid", flatBottom })}
      name="Tool 1" count={count} draft={draft} onDraftChange={setDraft} onSave={save} onLater={later} onEditBinHeight={editHeight} />;
  }
  React.act(() => root.render(<Question />));
}
function button(label: string) { return [...host.querySelectorAll("button")].find(button => button.textContent === label)!; }
function enter(value: string) { React.act(() => { const input = host.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }

it("starts blank with every depth option visible and lets the user defer without a guessed depth", () => {
  render();
  expect(button("Done").disabled).toBe(true);
  expect(host.querySelector("details")).toBeNull();
  expect([...host.querySelectorAll('[aria-label="Pocket depth options"] button')].map(button => button.textContent))
    .toEqual(["Fixed depth", "To bin floor", "Through — no bottom"]);
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
  expect(host.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!.disabled).toBe(true);
  React.act(() => button("Fixed depth").click());
  expect(host.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!.value).toBe("8");
  expect(host.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!.disabled).toBe(false);
  React.act(() => button("Through — no bottom").click()); React.act(() => button("Done").click());
  expect(save).toHaveBeenCalledWith({ mode: "through" }, false);
});

it("explains exposed tool height and draws an open bottom only for Through", () => {
  render();
  expect(host.textContent).toContain("A 12 mm-thick tool in an 8 mm-deep pocket sticks out 4 mm above the bin surface.");
  const material = () => host.querySelector('[data-testid="pocket-depth-material"]')!;
  expect(material().querySelector("path")).not.toBeNull();
  React.act(() => button("Through — no bottom").click());
  expect(host.querySelector("svg")?.getAttribute("aria-label")).toContain("with no bottom");
  expect(material().querySelector("path")).toBeNull();
  const walls = [...material().querySelectorAll("rect")];
  expect(walls).toHaveLength(2);
  expect(Number(walls[0].getAttribute("x")) + Number(walls[0].getAttribute("width")))
    .toBeLessThan(Number(walls[1].getAttribute("x")));
  React.act(() => button("To bin floor").click());
  expect(material().querySelector("path")).not.toBeNull();
  expect(material().querySelector("rect")).toBeNull();
  React.act(() => button("Fixed depth").click());
  expect(material().querySelector("path")).not.toBeNull();
});

it("offers bin-height recovery only for a depth the bin can make room for", () => {
  render(); enter("50");
  expect(button("Done").disabled).toBe(true);
  React.act(() => button("Edit bin height").click());
  expect(editHeight).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
  enter("121");
  expect(button("Edit bin height")).toBeUndefined();
  enter("8");
  expect(button("Edit bin height")).toBeUndefined();
});
