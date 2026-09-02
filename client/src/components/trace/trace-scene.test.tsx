import * as React from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Calibration, DraftCalibration } from "@shared/geometry/scale";
import type { Point } from "@shared/geometry/types";

import { TraceScene } from "./trace-scene";

const calibration: Calibration = {
  startX: 10,
  startY: 20,
  endX: 110,
  endY: 20,
  lengthMm: 50,
};

function renderRuler({
  completed = null,
  draft = null,
  rulerLengthMm = 100,
  rulerEditable = false,
  perspectivePoints = [],
  perspectiveEditable = false,
  perspectivePreview = null,
}: {
  completed?: Calibration | null;
  draft?: DraftCalibration | null;
  rulerLengthMm?: number;
  rulerEditable?: boolean;
  perspectivePoints?: readonly Point[];
  perspectiveEditable?: boolean;
  perspectivePreview?: Point | null;
}): string {
  return renderToStaticMarkup(
    <TraceScene
      imageUrl="data:image/png;base64,AA=="
      imageSize={{ width: 200, height: 100 }}
      transform={{ scale: 1, translateX: 0, translateY: 0 }}
      outline={[]}
      selection={null}
      region={null}
      calibration={completed}
      draftCalibration={draft}
      rulerLengthMm={rulerLengthMm}
      rulerEditable={rulerEditable}
      perspectivePoints={perspectivePoints}
      perspectiveEditable={perspectiveEditable}
      perspectivePreview={perspectivePreview}
    />,
  );
}

function count(markup: string, fragment: string): number {
  return markup.split(fragment).length - 1;
}

describe("TraceScene ruler overlay", () => {
  it("renders completed endpoints as persistent X markers with a length label", () => {
    const markup = renderRuler({ completed: calibration });

    expect(count(markup, 'data-testid="ruler-marker"')).toBe(2);
    expect(count(markup, "data-ruler-handle=")).toBe(2);
    expect(count(markup, 'data-testid="ruler-handle-hit-area"')).toBe(2);
    expect(markup).toContain('r="18"');
    expect(markup).toContain("cursor-grab");
    expect(markup).toContain("Drag the start scale point");
    expect(markup).toContain("Drag the end scale point");
    expect(markup).toContain('data-testid="ruler-line"');
    expect(markup).toContain('data-testid="ruler-length-label"');
    expect(markup).toContain("50 mm");
    expect(markup).toContain("M 3 13 L 17 27 M 17 13 L 3 27");
  });

  it("advertises inline editing only for a committed ruler", () => {
    const markup = renderRuler({
      completed: calibration,
      rulerEditable: true,
    });
    expect(markup).toContain('role="button"');
    expect(markup).toContain("Double-click to edit the reference length");
    expect(markup).toContain("Edit reference length, currently 50 mm");

    const preview = renderRuler({
      draft: { startX: 10, startY: 20, endX: 80, endY: 70 },
    });
    expect(preview).not.toContain("Double-click to edit the reference length");
  });

  it("renders a live dashed ruler from the first marker to the pointer", () => {
    const markup = renderRuler({
      draft: { startX: 10, startY: 20, endX: 80, endY: 70 },
      rulerLengthMm: 125.5,
    });

    expect(count(markup, 'data-testid="ruler-marker"')).toBe(2);
    expect(count(markup, "data-ruler-handle=")).toBe(0);
    expect(markup).toContain('data-ruler-preview="true"');
    expect(markup).toContain('stroke-dasharray="6 4"');
    expect(markup).not.toContain('data-testid="ruler-length-label"');
    expect(markup).not.toContain("125.5 mm");
  });

  it("keeps inline-editor text screen-sized while the scene is zoomed", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      await React.act(async () => {
        root.render(
          <TraceScene
            imageUrl="data:image/png;base64,AA=="
            imageSize={{ width: 200, height: 100 }}
            transform={{ scale: 4, translateX: 0, translateY: 0 }}
            outline={[]}
            selection={null}
            region={null}
            calibration={calibration}
            draftCalibration={null}
            rulerLengthMm={100}
            rulerEditable
          />,
        );
      });

      await React.act(async () => {
        host
          .querySelector<SVGGElement>('[data-testid="ruler-length-label"]')
          ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      });

      const input = document.querySelector<HTMLInputElement>(
        '[data-testid="ruler-length-inline-input"]',
      );
      const editor = document.querySelector<HTMLElement>(
        '[data-testid="ruler-length-inline-editor"]',
      );
      expect(editor?.parentElement).toBe(document.body);
      expect(editor?.style.position || editor?.className).toContain("fixed");
      expect(editor?.style.width).toBe("96px");
      expect(editor?.style.height).toBe("30px");
      expect(input?.type).toBe("text");
      expect(input?.className).toContain("text-xs");
      expect(input?.className).toContain("text-foreground");
      expect(document.activeElement).toBe(input);
    } finally {
      React.act(() => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it("shows only the first X before the pointer supplies a preview endpoint", () => {
    const markup = renderRuler({ draft: { startX: 10, startY: 20 } });

    expect(count(markup, 'data-testid="ruler-marker"')).toBe(1);
    expect(markup).not.toContain('data-testid="ruler-line"');
    expect(markup).not.toContain('data-testid="ruler-length-label"');
  });

  it("renders four numbered, editable perspective corners as a closed quad", () => {
    const markup = renderRuler({
      perspectivePoints: [
        { x: 10, y: 10 },
        { x: 190, y: 12 },
        { x: 188, y: 90 },
        { x: 12, y: 88 },
      ],
      perspectiveEditable: true,
    });

    expect(count(markup, 'data-testid="perspective-marker"')).toBe(4);
    expect(count(markup, "data-perspective-handle=")).toBe(4);
    expect(markup).toContain('data-testid="perspective-outline"');
    expect(markup).toContain("L 12 88 Z");
  });

  it("previews the next manual perspective edge at the pointer", () => {
    const markup = renderRuler({
      perspectivePoints: [
        { x: 10, y: 10 },
        { x: 190, y: 12 },
      ],
      perspectiveEditable: true,
      perspectivePreview: { x: 180, y: 90 },
    });

    expect(markup).toContain('data-perspective-preview="true"');
    expect(markup).toContain("L 180 90");
  });
});
