// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ path: "/" }));
vi.mock("wouter", () => ({ useLocation: () => [route.path, vi.fn()], useSearch: () => "" }));

let Welcome: typeof import("./app-welcome").AppWelcome;
let Provider: typeof import("@/state/experimental-features").ExperimentalFeaturesProvider;
let SettingsDialog: typeof import("./experimental-features-dialog").ExperimentalFeaturesDialog;
let host: HTMLDivElement;
let root: Root;
let values: Map<string, string>;
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };
let resizeListeners: Set<() => void>;
const KEY = "pocketry:welcome:1.1.1";
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const render = async () => React.act(async () => root.render(<Provider><Welcome /><SettingsDialog /></Provider>));
const resize = async (width: number) => React.act(async () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  for (const listener of resizeListeners) listener();
});
const navigate = async (path: string) => { route.path = path; await render(); };
const close = async (label: string) => React.act(async () => {
  Array.from(dialog()!.querySelectorAll("button")).find((button) => button.textContent === label)!.click();
});

beforeEach(async () => {
  // A fresh module represents a fresh page session; individual tests can then
  // remount without resetting it to verify the blocked-storage fallback.
  vi.resetModules();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  route.path = "/";
  values = new Map();
  storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
  vi.stubGlobal("localStorage", storage);
  resizeListeners = new Set();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  vi.stubGlobal("matchMedia", (query: string) => ({
    media: query,
    matches: window.innerWidth < 768,
    addEventListener: (_type: string, listener: () => void) => resizeListeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => resizeListeners.delete(listener),
  }));
  ({ AppWelcome: Welcome } = await import("./app-welcome"));
  ({ ExperimentalFeaturesProvider: Provider } = await import("@/state/experimental-features"));
  ({ ExperimentalFeaturesDialog: SettingsDialog } = await import("./experimental-features-dialog"));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  React.act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("new features welcome", () => {
  it("introduces the new layout and optional tools, with mobile feedback in the same dialog", async () => {
    await render();
    expect(dialog()?.textContent).toContain("New experimental tools and a new editor layout are available in Settings.");
    expect(dialog()?.textContent).toContain("Workflow left, properties right");
    expect(dialog()?.textContent).toContain("The mobile interface is still being refined.");
    expect(document.activeElement?.textContent).toBe("Welcome to Pocketry");
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(dialog()!.querySelector('a[href^="mailto:"]')).toBeNull();
    const github = dialog()!.querySelector<HTMLAnchorElement>('a[href="https://github.com/wcscr/pocketry/issues/new"]')!;
    expect(github.target).toBe("_blank");
    expect(github.rel).toBe("noopener noreferrer");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("welcomes desktop users too, while keeping About and unknown routes unobstructed", async () => {
    await resize(1280);
    await navigate("/about");
    expect(dialog()).toBeNull();
    await navigate("/missing");
    expect(dialog()).toBeNull();
    await navigate("/bin");
    expect(dialog()).not.toBeNull();
    expect(dialog()?.textContent).not.toContain("mobile interface");
    await resize(390);
    expect(dialog()?.textContent).toContain("mobile interface");
  });

  it("opens Settings without enabling tools or changing layouts until the user chooses", async () => {
    await render();
    await close("Open Settings");
    expect(values.get(KEY)).toBe("dismissed");
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(dialog()?.textContent).toContain("Choose which tools appear in Pocketry.");
    expect(dialog()?.contains(document.activeElement)).toBe(true);
    const toggle = document.querySelector<HTMLButtonElement>('#experimental-features')!;
    const workflow = document.querySelector<HTMLInputElement>('input[name="editor-layout"][value="workflow"]')!;
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(workflow.checked).toBe(false);
    expect(values.has('pocketry:experimental-features')).toBe(false);
    expect(values.has('pocketry:editor-layout')).toBe(false);
    await React.act(async () => { toggle.click(); workflow.click(); });
    expect(values.get('pocketry:experimental-features')).toBe('true');
    expect(values.get('pocketry:editor-layout')).toBe('workflow');
    await close("Close");
    expect(dialog()).toBeNull();
    await navigate("/bin");
    expect(dialog()).toBeNull();
  });

  it("shows this update even when the old mobile welcome was already dismissed", async () => {
    values.set('pocketry:mobile-development-welcome:v1', 'dismissed');
    await render();
    expect(dialog()).not.toBeNull();
  });

  it("persists Continue and does not reopen on navigation, resizing or a later page session", async () => {
    await render();
    await close("Continue");
    expect(storage.setItem).toHaveBeenCalledWith(KEY, "dismissed");
    expect(dialog()).toBeNull();
    await navigate("/bin");
    await resize(1280);
    await resize(390);
    expect(dialog()).toBeNull();
    React.act(() => root.unmount());
    vi.resetModules();
    ({ AppWelcome: Welcome } = await import("./app-welcome"));
    ({ ExperimentalFeaturesProvider: Provider } = await import("@/state/experimental-features"));
    ({ ExperimentalFeaturesDialog: SettingsDialog } = await import("./experimental-features-dialog"));
    root = createRoot(host);
    await render();
    expect(dialog()).toBeNull();
  });

  it.each(["Close", "Escape"])("remembers dismissal with %s", async (method) => {
    await render();
    if (method === "Close") await close("Close");
    else await React.act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(dialog()).toBeNull();
    expect(values.get(KEY)).toBe("dismissed");
  });

  it("does not repeat after navigating away from an open welcome", async () => {
    await render();
    await navigate("/about");
    expect(dialog()).toBeNull();
    await navigate("/bin");
    expect(dialog()).toBeNull();
  });

  it("respects a dismissal already stored by a previous session", async () => {
    values.set(KEY, "dismissed");
    await render();
    expect(dialog()).toBeNull();
  });

  it("still dismisses and stays dismissed within the session when browser storage is blocked", async () => {
    storage.getItem.mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    storage.setItem.mockImplementation(() => { throw new DOMException("Quota exceeded", "QuotaExceededError"); });
    await render();
    expect(dialog()).not.toBeNull();
    await close("Continue");
    await navigate("/bin");
    await resize(1280);
    await resize(390);
    React.act(() => root.unmount());
    root = createRoot(host);
    await render();
    expect(dialog()).toBeNull();
  });
});
