// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./app-shell";
import { CanvasToolbar } from "./canvas-toolbar";
import { PanelBody, PanelFooter, PanelSection } from "./panel-section";
import { WorkspaceLayout } from "./workspace-layout";

/** jsdom has no ResizeObserver, and react-resizable-panels constructs one. */
class NoopResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/**
 * Render into a detached root and return the resulting markup.
 *
 * These are smoke tests: jsdom performs no layout, so the panel group never
 * gets real widths and the assertions stay on structure rather than geometry.
 * Their job is to catch the failures that only show up once the components
 * actually run — a crash from an imperative API called too early, a mobile
 * branch that never renders its canvas.
 */
function render(ui: React.ReactElement, { mobile = false, landscape = false, inspect }: {
  mobile?: boolean;
  landscape?: boolean;
  inspect?: (container: HTMLDivElement) => void;
} = {}) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  // jsdom does not implement matchMedia, which useIsMobile() calls unguarded.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-height") ? landscape : mobile,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  Object.defineProperty(window, "innerWidth", {
    value: mobile ? 400 : landscape ? 844 : 1440,
    writable: true,
    configurable: true,
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  React.act(() => root.render(ui));

  inspect?.(container);
  const html = container.innerHTML;
  React.act(() => root.unmount());
  container.remove();
  return html;
}

afterEach(() => {
  vi.unstubAllGlobals();
  // jsdom 30 defers Web Storage to the platform, and Node provides
  // localStorage only when launched with --localstorage-file — so the global
  // can legitimately be absent here. Clear it only when it exists.
  globalThis.localStorage?.clear();
});

describe("AppShell", () => {
  it("keeps the body a zero-min-height flex child so the canvas cannot grow the page", () => {
    const html = render(
      <AppShell header={<span>ToolTrace</span>}>
        <div>body</div>
      </AppShell>,
    );

    expect(html).toContain("ToolTrace");
    expect(html).toContain("min-h-0 flex-1");
    expect(html).toContain("h-dvh");
  });

  it("omits the header bar when no header is given", () => {
    const html = render(
      <AppShell>
        <div>body</div>
      </AppShell>,
    );

    expect(html).not.toContain("<header");
  });
});

describe("WorkspaceLayout", () => {
  const noop = () => {};

  it("keeps both panel handles reachable on short landscape screens without remounting the canvas", () => {
    render(<WorkspaceLayout autoSaveId="test:inspector" panelOpen onPanelOpenChange={noop}
      panel={<div>object-list</div>} canvas={<div>canvas</div>} inspector={<div>selection-properties</div>} />, {
      landscape: true,
      inspect: container => {
        const canvas = container.querySelector('[data-testid="inspector-workspace-canvas"]');
        expect(canvas).not.toBeNull();
        const click = (label: string) => React.act(() => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
        click('Expand objects panel');
        expect(container.querySelector('#objects-panel')!.hasAttribute('hidden')).toBe(false);
        expect(container.querySelector('#workflow-panel')!.hasAttribute('hidden')).toBe(true);
        click('Collapse objects panel'); click('Expand workflow panel');
        expect(container.querySelector('#workflow-panel')!.hasAttribute('hidden')).toBe(false);
        expect(container.querySelector('[data-testid="inspector-workspace-canvas"]')).toBe(canvas);
        expect(canvas!.closest('#workflow-panel, #objects-panel, [role="dialog"]')).toBeNull();
      },
    });
  });

  it("renders panel and canvas side by side on desktop", () => {
    const html = render(
      <WorkspaceLayout
        autoSaveId="tooltrace:test"
        panelOpen
        onPanelOpenChange={noop}
        panel={<div>panel-content</div>}
        canvas={<div>canvas-content</div>}
      />,
    );

    expect(html).toContain("panel-content");
    expect(html).toContain("canvas-content");
    // Both panels must be allowed to shrink below their content width, or the
    // drag handle jams well above minPanelSize.
    expect(html.match(/min-w-0/g)).toHaveLength(2);
  });

  it("mounts without touching the panel group's imperative API before it has a layout", () => {
    // Regression: isCollapsed()/isExpanded() assert on a computed layout and
    // throw "Panel size not found" when called from the mount effect.
    expect(() =>
      render(
        <WorkspaceLayout
          autoSaveId="tooltrace:test"
          panelOpen={false}
          onPanelOpenChange={noop}
          panel={<div>panel-content</div>}
          canvas={<div>canvas-content</div>}
        />,
      ),
    ).not.toThrow();
  });

  it("excludes collapsed controls from interaction and accessibility, then restores them when opened", () => {
    function ToggleWorkspace(): JSX.Element {
      const [open, setOpen] = React.useState(false);
      return <>
        <button onClick={() => setOpen((current) => !current)}>Toggle controls</button>
        <WorkspaceLayout autoSaveId="tooltrace:hidden-test" panelOpen={open}
          onPanelOpenChange={setOpen} panel={<button>Panel action</button>}
          canvas={<button>Canvas action</button>} />
      </>;
    }
    render(<ToggleWorkspace />, { inspect: (container) => {
      const controls = container.querySelector('[data-testid="desktop-workspace-controls"]')!;
      const toggle = container.querySelector<HTMLButtonElement>("button")!;
      expect(controls.hasAttribute("inert")).toBe(true);
      expect(controls.getAttribute("aria-hidden")).toBe("true");
      // Keeping the subtree mounted preserves its local input state.
      expect(controls.textContent).toContain("Panel action");
      React.act(() => toggle.click());
      expect(controls.hasAttribute("inert")).toBe(false);
      expect(controls.hasAttribute("aria-hidden")).toBe(false);
      React.act(() => toggle.click());
      expect(controls.hasAttribute("inert")).toBe(true);
      expect(controls.getAttribute("aria-hidden")).toBe("true");
    } });
  });

  it("puts the canvas last when the panel sits on the right", () => {
    const html = render(
      <WorkspaceLayout
        autoSaveId="tooltrace:test"
        panelSide="right"
        panelOpen
        onPanelOpenChange={noop}
        panel={<div>panel-content</div>}
        canvas={<div>canvas-content</div>}
      />,
    );

    expect(html.indexOf("canvas-content")).toBeLessThan(
      html.indexOf("panel-content"),
    );
  });

  it("drops the panel group on mobile and keeps the canvas outside the drawer", () => {
    const html = render(
      <WorkspaceLayout
        autoSaveId="tooltrace:test"
        panelOpen={false}
        onPanelOpenChange={noop}
        panel={<div>panel-content</div>}
        canvas={<div>canvas-content</div>}
      />,
      { mobile: true },
    );

    // The canvas must stay out of the drawer: vaul animates with CSS
    // transforms, which getScreenCTM() would fold into the canvas' mapping.
    expect(html).toContain("canvas-content");
    expect(html).not.toContain("resize-handle");
  });
});

describe("PanelSection", () => {
  it("renders open by default and hides the body when closed", () => {
    const open = render(
      <PanelSection title="Threshold">
        <p>slider</p>
      </PanelSection>,
    );
    expect(open).toContain("Threshold");
    expect(open).toContain("<p>slider</p>");

    const closed = render(
      <PanelSection title="Threshold" defaultOpen={false}>
        <p>slider</p>
      </PanelSection>,
    );
    // The header stays visible; only the body unmounts.
    expect(closed).toContain("Threshold");
    expect(closed).not.toContain("<p>slider</p>");
  });

  it("disables the trigger when disabled", () => {
    const html = render(
      <PanelSection title="Export" disabled>
        <p>controls</p>
      </PanelSection>,
    );

    expect(html).toContain("disabled");
  });

  it("composes a scrolling body over a pinned footer", () => {
    const html = render(
      <div className="flex h-full flex-col">
        <PanelBody>
          <PanelSection title="Threshold">
            <p>controls</p>
          </PanelSection>
        </PanelBody>
        <PanelFooter>export</PanelFooter>
      </div>,
    );

    expect(html).toContain("min-h-0 flex-1 overflow-y-auto");
    expect(html).toContain("shrink-0 border-t");
  });
});

describe("CanvasToolbar", () => {
  it("defaults to the top-left corner", () => {
    const html = render(<CanvasToolbar>zoom</CanvasToolbar>);
    expect(html).toContain("left-2 top-2");
    expect(html).toContain("absolute");
  });

  it("honours the requested corner", () => {
    const html = render(
      <CanvasToolbar position="bottom-right">zoom</CanvasToolbar>,
    );
    expect(html).toContain("bottom-2 right-2");
  });
});
