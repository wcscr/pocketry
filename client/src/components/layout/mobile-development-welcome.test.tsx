// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ path: "/" }));
vi.mock("wouter", () => ({ useLocation: () => [route.path, vi.fn()] }));

let Welcome: typeof import("./mobile-development-welcome").MobileDevelopmentWelcome;
let host: HTMLDivElement;
let root: Root;
let values: Map<string, string>;
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };
let resizeListeners: Set<() => void>;
const KEY = "pocketry:mobile-development-welcome:v1";
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const render = async () => React.act(async () => root.render(<Welcome />));
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
  ({ MobileDevelopmentWelcome: Welcome } = await import("./mobile-development-welcome"));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  React.act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("mobile development welcome", () => {
  it("shows the mobile introduction and feedback links without navigating or opening another app", async () => {
    await render();
    expect(dialog()?.textContent).toContain("The mobile interface is in early development.");
    expect(dialog()?.textContent).toContain("We’re looking for feedback");
    expect(document.activeElement?.textContent).toBe("Help improve Pocketry on mobile");
    const email = dialog()!.querySelector('a[href="mailto:pocketry@sugarcreekresearch.com"]');
    expect(email?.textContent).toBe("Email feedback");
    const github = dialog()!.querySelector<HTMLAnchorElement>('a[href="https://github.com/wcscr/pocketry/issues/new"]')!;
    expect(github.target).toBe("_blank");
    expect(github.rel).toBe("noopener noreferrer");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("stays out of desktop, About and unknown routes, then welcomes a mobile workspace", async () => {
    await resize(1280);
    await render();
    expect(dialog()).toBeNull();
    await navigate("/about");
    await resize(390);
    expect(dialog()).toBeNull();
    await navigate("/missing");
    expect(dialog()).toBeNull();
    await navigate("/bin");
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
    ({ MobileDevelopmentWelcome: Welcome } = await import("./mobile-development-welcome"));
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

  it.each(["route", "viewport"])("does not repeat after leaving an open welcome by changing the %s", async (change) => {
    await render();
    if (change === "route") await navigate("/about");
    else await resize(1280);
    expect(dialog()).toBeNull();
    await navigate("/bin");
    await resize(390);
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
