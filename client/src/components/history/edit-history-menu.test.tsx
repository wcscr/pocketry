// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditHistoryMenu } from "./edit-history-menu";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("EditHistoryMenu", () => {
  it("shows named undo and redo states and jumps to a selected step", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onJump = vi.fn();

    React.act(() => {
      root.render(
        <EditHistoryMenu
          entries={[
            { label: "Detected outline" },
            { label: "Add contour node" },
            { label: "Move contour node" },
          ]}
          index={1}
          onJump={onJump}
          testId="button-test-history"
        />,
      );
    });

    React.act(() => {
      (
        host.querySelector(
          '[data-testid="button-test-history"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(document.body.textContent).toContain("Edit history");
    expect(document.body.textContent).toContain("Step 2 of 3");
    expect(document.body.textContent).toContain("Add contour node");
    expect(document.body.textContent).toContain("Move contour node");
    expect(document.body.textContent).toContain("Redo");

    React.act(() => {
      (
        document.querySelector(
          '[data-testid="history-step-0"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(onJump).toHaveBeenCalledWith(0);

    React.act(() => root.unmount());
  });
});
