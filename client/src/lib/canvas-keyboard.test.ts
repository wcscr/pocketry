// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { canHandleCanvasShortcut } from "./canvas-keyboard";

afterEach(() => document.body.replaceChildren());

function eligible(target: Element = document.body, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return canHandleCanvasShortcut(event);
}

describe("canvas keyboard ownership", () => {
  it("allows canvas/background shortcuts, including keyboard focus on the canvas", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    document.body.appendChild(svg);
    expect(eligible()).toBe(true);
    expect(eligible(svg)).toBe(true);
  });

  it.each([
    '<button><svg><path /></svg></button>', '<a href="#">Link</a>',
    '<input />', '<textarea />', '<select><option>One</option></select>',
    '<details><summary>Advanced</summary></details>', '<div contenteditable="true"><span>Text</span></div>',
    '<span role="slider" tabindex="0"></span>', '<div role="tab" tabindex="0"></div>',
    '<div role="menuitem" tabindex="0"></div>', '<div role="switch" tabindex="0"></div>',
  ])("leaves native and ARIA controls in charge: %s", (html) => {
    document.body.innerHTML = html;
    const target = document.body.querySelector("path, span, summary, option") ?? document.body.firstElementChild!;
    expect(eligible(target)).toBe(false);
  });

  it.each(["dialog", "alertdialog", "menu", "listbox"])("blocks background keys while an open %s owns input", (role) => {
    document.body.innerHTML = `<div role="${role}"><p>Open overlay</p></div>`;
    expect(eligible()).toBe(false);
    expect(eligible(document.querySelector("p")!)).toBe(false);
  });

  it.each(['hidden', 'inert', 'aria-hidden="true"', 'data-state="closed"', 'style="display:none"', 'style="visibility:hidden"'])("ignores retained hidden overlays: %s", (attribute) => {
    document.body.innerHTML = `<div ${attribute}><div role="dialog">Closed overlay</div></div>`;
    expect(eligible()).toBe(true);
  });

  it("respects earlier event handlers and IME composition", () => {
    const event = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, cancelable: true });
    event.preventDefault();
    expect(canHandleCanvasShortcut(event)).toBe(false);
    expect(eligible(document.body, { isComposing: true })).toBe(false);
  });

  it("allows a canvas tool's Escape from its button, while dialogs and widgets retain Escape", () => {
    document.body.innerHTML = '<button>Measure</button><button role="combobox">Choose</button>';
    const button = document.querySelector("button")!;
    expect(eligible(button, { key: "Escape" })).toBe(true);
    expect(eligible(document.querySelector('[role="combobox"]')!, { key: "Escape" })).toBe(false);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    expect(eligible(button, { key: "Escape" })).toBe(false);
  });
});
