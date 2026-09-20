// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowHint } from "./workflow-hint";

let host: HTMLDivElement;
let root: Root;
const canvasDown = vi.fn();
function render(key = "region", text = "Draw a region") {
  React.act(() => root.render(<div onPointerDown={canvasDown}><WorkflowHint hintKey={key}>{text}</WorkflowHint></div>));
}
function click(label: string) {
  React.act(() => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
}
function pointer(target: Element, type: string, x: number, y: number, id = 1) {
  React.act(() => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(event, "pointerId", { value: id });
    target.dispatchEvent(event);
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  canvasDown.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { React.act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("Dismissible workflow guidance", () => {
  it("stays dismissed while instructions change within a step, and can be reopened", () => {
    render(); click("Dismiss hint");
    render("region", "Keep this region or draw another");
    expect(host.querySelector('[role="status"]')).toBeNull();
    click("Show current hint");
    expect(host.textContent).toContain("Keep this region");
  });
  it("shows a new step but remembers dismissal when returning to an earlier step", () => {
    render(); click("Dismiss hint"); render("outline", "Edit the outline");
    expect(host.textContent).toContain("Edit the outline");
    render(); expect(host.querySelector('[role="status"]')).toBeNull();
  });
  it.each([[100, 0], [-100, 0], [0, -100], [0, 100]])("dismisses a swipe (%s, %s) without starting a canvas gesture", (dx, dy) => {
    render(); const hint = host.querySelector('[role="status"]')!;
    pointer(hint, "pointerdown", 120, 120); pointer(hint, "pointerup", 120 + dx, 120 + dy);
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(canvasDown).not.toHaveBeenCalled();
  });
  it("ignores taps, cancelled swipes, and a different pointer", () => {
    render(); const hint = host.querySelector('[role="status"]')!;
    pointer(hint, "pointerdown", 0, 0); pointer(hint, "pointerup", 10, 0);
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    pointer(hint, "pointerdown", 0, 0); pointer(hint, "pointercancel", 80, 0); pointer(hint, "pointerup", 90, 0);
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    pointer(hint, "pointerdown", 0, 0); pointer(hint, "pointerup", 90, 0, 2);
    expect(host.querySelector('[role="status"]')).not.toBeNull();
  });
});
