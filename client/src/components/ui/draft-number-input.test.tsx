// @vitest-environment jsdom
import * as React from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DraftNumberInput } from "./draft-number-input";

function mountNumber(value = 12) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const committed: number[] = [];

  function Probe(): JSX.Element {
    const [current, setCurrent] = React.useState(value);
    return (
      <DraftNumberInput
        aria-label="Measurement"
        value={current}
        min={1}
        onValueChange={(next) => {
          committed.push(next);
          setCurrent(next);
        }}
      />
    );
  }

  React.act(() => root.render(<Probe />));
  const input = host.querySelector("input") as HTMLInputElement;
  return {
    input,
    committed,
    change(next: string) {
      React.act(() => {
        input.focus();
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!;
        setter.call(input, next);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    },
    blur() {
      React.act(() => input.blur());
    },
    unmount() {
      React.act(() => root.unmount());
      host.remove();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("DraftNumberInput", () => {
  it("allows the last digit to be deleted before typing a replacement", () => {
    const view = mountNumber();
    view.change("");
    expect(view.input.value).toBe("");
    expect(view.committed).toEqual([]);

    view.change("7");
    expect(view.input.value).toBe("7");
    expect(view.committed).toEqual([7]);
    view.unmount();
  });

  it("restores the previous valid value when an empty draft loses focus", () => {
    const view = mountNumber();
    view.change("");
    view.blur();
    expect(view.input.value).toBe("12");
    expect(view.committed).toEqual([]);
    view.unmount();
  });
});
