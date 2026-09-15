// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HelpHint } from "./help-hint";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  React.act(() => root.render(
    <details><summary>Edges <HelpHint label="edges">A radius of 0 keeps the edge sharp.</HelpHint></summary><p>Settings</p></details>,
  ));
});
afterEach(() => {
  React.act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("reveals optional guidance on keyboard focus and dismisses it with Escape", async () => {
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  await React.act(async () => host.querySelector('button')!.focus());
  expect(document.querySelector('[role="tooltip"]')!.textContent).toContain('0 keeps the edge sharp');
  React.act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  expect(host.querySelector('details')!.open).toBe(false);
});

it("toggles guidance by tapping without expanding the enclosing settings", async () => {
  await React.act(async () => host.querySelector('button')!.click());
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  expect(host.querySelector('details')!.open).toBe(false);
  React.act(() => host.querySelector('button')!.click());
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  expect(host.querySelector('details')!.open).toBe(false);
});
