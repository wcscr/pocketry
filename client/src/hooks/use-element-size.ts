import * as React from "react";

/** Rendered size of an element, in CSS pixels (border box). */
export interface Size {
  width: number;
  height: number;
}

const EMPTY: Size = { width: 0, height: 0 };

// `useLayoutEffect` logs a warning when React renders without a DOM, where
// there is no layout to read anyway. The app is a pure SPA today; the swap only
// keeps this hook importable from a non-browser environment.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

/**
 * Track the rendered size of an element.
 *
 * Returns a ref to attach to the element, plus its current size.
 *
 * The measurement comes from a `ResizeObserver` rather than a `window.resize`
 * listener on purpose: the canvas region lives inside a `ResizablePanel`, so
 * most of the size changes it cares about come from the user dragging the panel
 * handle. Those never fire a window resize event, so a window listener would
 * leave the canvas stale after every drag.
 */
export function useElementSize<T extends Element>(): [React.RefObject<T>, Size] {
  const ref = React.useRef<T>(null);
  const [size, setSize] = React.useState<Size>(EMPTY);

  useIsomorphicLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const readSize = (entry?: ResizeObserverEntry): Size => {
      // Prefer the observer's own box measurement: it reports the untransformed
      // layout size, whereas `getBoundingClientRect()` folds in ancestor CSS
      // transforms (a vaul drawer mid-animation, say) and would briefly report a
      // scaled box. `borderBoxSize` is missing on older Safari, hence the
      // fallback. Inline/block map to width/height for horizontal writing modes,
      // which is all this app renders in.
      const box = entry?.borderBoxSize?.[0];
      if (box) return { width: box.inlineSize, height: box.blockSize };
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    };

    const apply = (next: Size) => {
      // Keep the previous object when the numbers have not moved. A
      // ResizeObserver fires on every layout pass that touches the element, and
      // consumers use this size as an effect dependency.
      setSize((prev) =>
        prev.width === next.width && prev.height === next.height ? prev : next,
      );
    };

    // Measure before the browser paints, so the first frame is already sized
    // instead of rendering once at 0 x 0 and correcting a frame later.
    apply(readSize());

    // jsdom and non-browser environments have no ResizeObserver. Degrade to the
    // single measurement above rather than throwing on `new ResizeObserver`.
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      apply(readSize(entries.at(-1)));
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return [ref, size];
}
