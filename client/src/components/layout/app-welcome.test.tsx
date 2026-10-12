// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ path: "/", navigate: vi.fn() }));
vi.mock("wouter", () => ({ useLocation: () => [route.path, route.navigate], useSearch: () => "" }));

let Welcome: typeof import("./app-welcome").AppWelcome;
let Panels: typeof import("./panel-context").PanelProvider;
let panelState: ReturnType<typeof import("./panel-context").usePanelState>;
let PanelProbe: () => null;
let Provider: typeof import("@/state/experimental-features").ExperimentalFeaturesProvider;
let SettingsDialog: typeof import("./experimental-features-dialog").ExperimentalFeaturesDialog;
let host: HTMLDivElement;
let root: Root;
let values: Map<string, string>;
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };
let resizeListeners: Set<() => void>;
const KEY = "pocketry:welcome:1.1.1";
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]:not([aria-hidden="true"])');
const render = async () => React.act(async () => root.render(<Panels><PanelProbe /><Provider><Welcome /><SettingsDialog /></Provider></Panels>));
const resize = async (width: number) => React.act(async () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  for (const listener of resizeListeners) listener();
});
const navigate = async (path: string) => { route.path = path; await render(); };
const close = async (label: string) => React.act(async () => {
  Array.from(dialog()!.querySelectorAll("button")).find((button) => button.textContent?.trim() === label)!.click();
});

beforeEach(async () => {
  // A fresh module represents a fresh page session; individual tests can then
  // remount without resetting it to verify the blocked-storage fallback.
  vi.resetModules();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  route.path = "/";
  route.navigate.mockReset();
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
  const panelModule = await import("./panel-context");
  Panels = panelModule.PanelProvider;
  PanelProbe = () => { panelState = panelModule.usePanelState(); return null; };
  ({ ExperimentalFeaturesProvider: Provider } = await import("@/state/experimental-features"));
  ({ ExperimentalFeaturesDialog: SettingsDialog } = await import("./experimental-features-dialog"));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await React.act(async () => {
    root.unmount();
    // Radix restores focus on the next task; finish before the next test.
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  host.remove();
  vi.unstubAllGlobals();
});

describe("first-use welcome", () => {
  it("explains the photo-to-bin workflow and keeps useful resources within reach", async () => {
    await render();
    expect(dialog()?.textContent).toContain("Design custom Gridfinity or flat-bottom bins, or create templates for laser etching and UV printing.");
    expect(dialog()!.querySelectorAll('ol[aria-label="From photo to bin"] li')).toHaveLength(3);
    expect(dialog()?.textContent).toContain("Projects are saved only in this browser.");
    expect(dialog()?.textContent).toContain("Backups");
    expect(dialog()?.textContent).toContain("Or skip this and go to step 3 to create an empty bin or one with basic shapes.");
    expect(document.activeElement?.textContent?.trim()).toBe("Welcome to Pocketry");
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(dialog()?.textContent).toContain("Open sample projects");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("welcomes desktop and phone users while keeping other routes unobstructed", async () => {
    await resize(1280);
    await navigate("/about");
    expect(dialog()).toBeNull();
    await navigate("/missing");
    expect(dialog()).toBeNull();
    await navigate("/bin");
    expect(dialog()).not.toBeNull();
    await resize(390);
    expect(dialog()).not.toBeNull();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });

  it.each([
    ["/bin", "Start tracing", "/"],
    ["/", "Design a bin", "/bin"],
    ["/", "Start tracing", "/"],
    ["/bin", "Design a bin", "/bin"],
  ])("takes %s users to the workspace for %s without changing their settings", async (from, action, to) => {
    await navigate(from);
    await close(action);
    expect(values.get(KEY)).toBe("dismissed");
    expect(dialog()).toBeNull();
    if (from !== to) expect(route.navigate).toHaveBeenCalledWith(to);
    else expect(route.navigate).not.toHaveBeenCalled();
    expect(values.has('pocketry:experimental-features')).toBe(false);
    expect(values.has('pocketry:editor-layout')).toBe(false);
  });

  it("opens the in-app samples without changing editor preferences", async () => {
    await render();
    await close("Open sample projects");
    expect(panelState.sampleLibraryRequested).toBe(true);
    expect(route.navigate).toHaveBeenCalledWith("/bin");
    expect(values.get(KEY)).toBe("dismissed");
  });

  it("opens calibration aids and returns to the welcome without dismissing it", async () => {
    await render();
    const download = Array.from(dialog()!.querySelectorAll("button")).find(button => button.textContent === "Download optional calibration aids")!;
    React.act(() => download.focus());
    await close("Download optional calibration aids");
    const aids = dialog()!;
    expect(aids.textContent).toContain("Print at 100%");
    expect(aids.textContent).toContain("A4 PDF");
    expect(aids.textContent).toContain("US Letter PDF");
    expect(values.has(KEY)).toBe(false);
    await close("Close");
    expect(dialog()?.textContent).toContain("Welcome to Pocketry");
    await vi.waitFor(() => expect(document.activeElement).toBe(download));
    expect(values.has(KEY)).toBe(false);
  });

  it("returns keyboard focus to the previous control when closed", async () => {
    const previous = document.createElement("button");
    document.body.append(previous);
    previous.focus();
    try {
      await render();
      await close("Close");
      await vi.waitFor(() => expect(document.activeElement).toBe(previous));
    } finally {
      previous.remove();
    }
  });

  it("shows the welcome even when the old mobile welcome was already dismissed", async () => {
    values.set('pocketry:mobile-development-welcome:v1', 'dismissed');
    await render();
    expect(dialog()).not.toBeNull();
  });

  it("persists Start tracing and does not reopen on navigation, resizing or a later page session", async () => {
    await render();
    await close("Start tracing");
    expect(storage.setItem).toHaveBeenCalledWith(KEY, "dismissed");
    expect(dialog()).toBeNull();
    await navigate("/bin");
    await resize(1280);
    await resize(390);
    expect(dialog()).toBeNull();
    React.act(() => root.unmount());
    vi.resetModules();
    ({ AppWelcome: Welcome } = await import("./app-welcome"));
  const panelModule = await import("./panel-context");
  Panels = panelModule.PanelProvider;
  PanelProbe = () => { panelState = panelModule.usePanelState(); return null; };
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
    await close("Start tracing");
    await navigate("/bin");
    await resize(1280);
    await resize(390);
    React.act(() => root.unmount());
    root = createRoot(host);
    await render();
    expect(dialog()).toBeNull();
  });
});
