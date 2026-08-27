import * as React from "react";

/**
 * Content → container mapping, applied with `transform-origin: 0 0`:
 *
 *     containerPoint = translate + contentPoint * scale
 *
 * which is literally `translate(tx, ty) scale(s)`, so it can be handed straight
 * to a CSS transform, an SVG `<g transform>`, or `CanvasRenderingContext2D`.
 *
 * The inverse is `contentPoint = (containerPoint - translate) / scale`. A hit
 * radius that should stay a constant number of *screen* pixels is therefore
 * `screenRadius / scale` in content units — the previous viewport hard-coded
 * radii in content units, so grab targets shrank visually as you zoomed in.
 */
export interface Transform {
  scale: number;
  translateX: number;
  translateY: number;
}

/** A point in some 2D space; which space is named by the parameter using it. */
export interface Point {
  x: number;
  y: number;
}

/** The four measurements a fit needs. */
export interface FitInput {
  /** Natural size of the scene, in content units (image pixels). */
  contentWidth: number;
  contentHeight: number;
  /** Measured size of the viewport, in CSS pixels (see `useElementSize`). */
  containerWidth: number;
  containerHeight: number;
  /** Breathing room left around the content when fitted, in CSS pixels. */
  padding?: number;
}

export interface UseViewportTransformOptions extends FitInput {
  /** Upper zoom limit. The lower limit is derived — see `fitScale`. */
  maxScale?: number;
  /**
   * What an unmodified wheel does. "pan" is the Figma/Illustrator model and the
   * default: a trackpad two-finger swipe scrolls the canvas, and zoom is
   * reserved for ctrl/meta (which is also what a trackpad pinch reports).
   */
  wheelMode?: "pan" | "zoom";
  /**
   * Whether a plain left-drag / one-finger drag pans. Set false while an
   * editing tool owns the pointer; middle-drag, Space-drag, Shift-drag and
   * two-finger pinch keep working regardless, so navigation is never lost.
   */
  panEnabled?: boolean;
}

export interface ViewportPointerHandlers {
  onPointerDown: React.PointerEventHandler;
  onPointerMove: React.PointerEventHandler;
  onPointerUp: React.PointerEventHandler;
  onPointerCancel: React.PointerEventHandler;
}

export interface ViewportTransformApi {
  transform: Transform;
  /** Scale at which the content fits the container, padding included. */
  fitScale: number;
  isPanning: boolean;
  /** Space is held: consumers should show a grab cursor. */
  isSpaceHeld: boolean;
  /** Frame the whole content, and resume following container resizes. */
  fit(): void;
  /**
   * Frame a rectangle given in content coordinates, padding included.
   * Counts as deliberate framing: container resizes will not refit afterwards.
   */
  fitToRect(rect: { x: number; y: number; width: number; height: number }): void;
  /** 1:1 pixels, centred. */
  resetZoom(): void;
  zoomBy(factor: number, anchorClient?: Point): void;
  zoomTo(scale: number, anchorClient?: Point): void;
  handlers: ViewportPointerHandlers;
  /** Ref callback for the element that should receive wheel events. */
  attachWheel(element: HTMLElement | SVGElement | null): void;
}

const IDENTITY: Transform = { scale: 1, translateX: 0, translateY: 0 };

const DEFAULT_PADDING = 24;
const DEFAULT_MAX_SCALE = 8;

/**
 * Floor on zoom-out, relaxed further whenever the content only fits at a
 * smaller scale. The viewport this replaces pinned the floor at 0.5, which made
 * an 800x600 photo impossible to fit into a 450px-tall pane.
 */
const ABSOLUTE_MIN_SCALE = 0.1;

/**
 * Wheel-to-zoom sensitivity, applied exponentially: one 120px notch is a ~20%
 * change *of the current scale*, so a notch feels the same at 0.2x and at 4x. A
 * linear step (the old `scale + deltaY * -0.01`) is jumpy when zoomed out and
 * sluggish when zoomed in, and can even walk the scale negative.
 */
const WHEEL_ZOOM_SPEED = 0.0015;

/** Rough line height for `deltaMode === DOM_DELTA_LINE` (Firefox mouse wheel). */
const WHEEL_LINE_PX = 16;
/** Fallback page height when the container has not been measured yet. */
const WHEEL_PAGE_PX = 800;

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

// `useLayoutEffect` warns when React renders without a DOM. Mirrors the swap in
// use-element-size.ts so this hook stays importable outside a browser.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isFittable(input: FitInput): boolean {
  return (
    isPositiveFinite(input.contentWidth) &&
    isPositiveFinite(input.contentHeight) &&
    isPositiveFinite(input.containerWidth) &&
    isPositiveFinite(input.containerHeight)
  );
}

/**
 * Largest scale at which the content fits inside the container with `padding`
 * on every side.
 *
 * Returns 1 rather than NaN/Infinity when any dimension is zero or non-finite:
 * both sizes legitimately start at 0 (no image loaded, container not yet
 * measured), and the old viewport propagated the resulting NaN into the CSS
 * transform, which blanks the canvas until a full remount.
 */
export function computeFitScale(input: FitInput): number {
  if (!isFittable(input)) return 1;

  const padding =
    Number.isFinite(input.padding) && (input.padding ?? 0) > 0
      ? (input.padding as number)
      : 0;

  // A pane narrower than twice the padding would give a negative — and so
  // mirrored — scale. Fall back to the unpadded box instead of flipping.
  const paddedWidth = input.containerWidth - 2 * padding;
  const paddedHeight = input.containerHeight - 2 * padding;
  const availableWidth = paddedWidth > 0 ? paddedWidth : input.containerWidth;
  const availableHeight =
    paddedHeight > 0 ? paddedHeight : input.containerHeight;

  const scale = Math.min(
    availableWidth / input.contentWidth,
    availableHeight / input.contentHeight,
  );
  return isPositiveFinite(scale) ? scale : 1;
}

/** `computeFitScale` plus the translation that centres the content. */
export function computeFitTransform(input: FitInput): Transform {
  if (!isFittable(input)) return IDENTITY;
  const scale = computeFitScale(input);
  return {
    scale,
    translateX: (input.containerWidth - input.contentWidth * scale) / 2,
    translateY: (input.containerHeight - input.contentHeight * scale) / 2,
  };
}

/**
 * Normalise a wheel event's delta to CSS pixels.
 *
 * `deltaMode` is per-browser and per-device — Firefox reports lines for a mouse
 * wheel where everything else reports pixels — so without this a Firefox notch
 * moves the canvas three pixels instead of forty-eight.
 */
function normaliseWheelDelta(event: WheelEvent, containerHeight: number): Point {
  const unit =
    event.deltaMode === DOM_DELTA_LINE
      ? WHEEL_LINE_PX
      : event.deltaMode === DOM_DELTA_PAGE
        ? isPositiveFinite(containerHeight)
          ? containerHeight
          : WHEEL_PAGE_PX
        : 1;
  return { x: event.deltaX * unit, y: event.deltaY * unit };
}

/** True for elements where the space bar means "type a space". */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Pointer capture keeps a drag alive once the cursor leaves the canvas; the old
 * viewport ended the pan on mouseleave, so a fast drag stopped dead at the edge.
 * Guarded because jsdom implements neither method and a browser throws if the
 * pointer is already gone by the time the handler runs.
 */
function capturePointer(target: Element, pointerId: number): void {
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // No capture available: the gesture still works while the pointer stays
    // inside the element, which is all jsdom ever exercises.
  }
}

function releasePointer(target: Element, pointerId: number): void {
  try {
    target.releasePointerCapture(pointerId);
  } catch {
    // Nothing captured — releasing is best-effort cleanup.
  }
}

type Gesture =
  | { kind: "pan"; pointerId: number; lastX: number; lastY: number }
  | {
      kind: "pinch";
      pointerIds: [number, number];
      lastDistance: number;
      lastMidX: number;
      lastMidY: number;
    };

/** Everything the imperative handlers need to read at event time. */
interface LiveOptions extends Required<FitInput> {
  maxScale: number;
  minScale: number;
  wheelMode: "pan" | "zoom";
  panEnabled: boolean;
}

/**
 * Pan/zoom state for a canvas viewport.
 *
 * The container size is an input rather than something this hook measures, so
 * the caller can feed it from `useElementSize` (which tracks panel drags, not
 * just window resizes) and so the maths stays testable without a layout engine.
 */
export function useViewportTransform(
  options: UseViewportTransformOptions,
): ViewportTransformApi {
  const {
    contentWidth,
    contentHeight,
    containerWidth,
    containerHeight,
    padding = DEFAULT_PADDING,
    maxScale = DEFAULT_MAX_SCALE,
    wheelMode = "pan",
    panEnabled = true,
  } = options;

  const fitInput = React.useMemo<Required<FitInput>>(
    () => ({
      contentWidth,
      contentHeight,
      containerWidth,
      containerHeight,
      padding,
    }),
    [contentWidth, contentHeight, containerWidth, containerHeight, padding],
  );
  const fitScale = React.useMemo(() => computeFitScale(fitInput), [fitInput]);
  // Zooming out to the fit scale must always be possible, whatever the floor.
  const minScale = Math.min(ABSOLUTE_MIN_SCALE, fitScale);

  const [transform, setTransform] = React.useState<Transform>(IDENTITY);
  const [isPanning, setIsPanning] = React.useState(false);
  const [isSpaceHeld, setIsSpaceHeld] = React.useState(false);

  // Gesture handlers read and write the transform many times per frame and must
  // never see a stale render's copy, so the ref is the source of truth and the
  // state is the render mirror.
  const transformRef = React.useRef<Transform>(IDENTITY);
  const commit = React.useCallback((next: Transform) => {
    const previous = transformRef.current;
    if (
      previous.scale === next.scale &&
      previous.translateX === next.translateX &&
      previous.translateY === next.translateY
    ) {
      return;
    }
    transformRef.current = next;
    setTransform(next);
  }, []);

  // Handlers are bound once — the wheel listener imperatively, the pointer
  // handlers as stable props — so current options come from a ref instead of a
  // rebind per render. Rebinding a {passive:false} wheel listener on every
  // transform change (what the old container did) drops events mid-gesture.
  const live = React.useRef<LiveOptions>({
    ...fitInput,
    maxScale,
    minScale,
    wheelMode,
    panEnabled,
  });
  useIsomorphicLayoutEffect(() => {
    live.current = { ...fitInput, maxScale, minScale, wheelMode, panEnabled };
  });

  /** Set once the user frames the view by hand; see the auto-fit effect. */
  const userAdjustedRef = React.useRef(false);
  const previousSizesRef = React.useRef({
    contentWidth: 0,
    contentHeight: 0,
    containerWidth: 0,
    containerHeight: 0,
  });

  // Auto-fit policy. A layout effect, not a passive one, so the first painted
  // frame is already framed instead of flashing at 1:1 and snapping.
  useIsomorphicLayoutEffect(() => {
    const previous = previousSizesRef.current;
    const contentChanged =
      previous.contentWidth !== contentWidth ||
      previous.contentHeight !== contentHeight;
    const containerChanged =
      previous.containerWidth !== containerWidth ||
      previous.containerHeight !== containerHeight;
    previousSizesRef.current = {
      contentWidth,
      contentHeight,
      containerWidth,
      containerHeight,
    };
    if (!contentChanged && !containerChanged) return;

    // A new image gets a fresh view, whatever the user did to the last one.
    if (contentChanged) {
      userAdjustedRef.current = false;
      commit(computeFitTransform(fitInput));
      return;
    }
    if (!userAdjustedRef.current) {
      commit(computeFitTransform(fitInput));
      return;
    }

    // The user has framed something deliberately, so never refit here: dragging
    // the panel handle would throw their framing away on every mouse move.
    // Keeping whatever sat at the centre of the old box at the centre of the new
    // one is the least surprising thing a resize can do.
    const dx = (containerWidth - previous.containerWidth) / 2;
    const dy = (containerHeight - previous.containerHeight) / 2;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const current = transformRef.current;
    commit({
      scale: current.scale,
      translateX: current.translateX + dx,
      translateY: current.translateY + dy,
    });
  }, [fitInput, contentWidth, contentHeight, containerWidth, containerHeight, commit]);

  // The element gestures are measured against. `attachWheel` sets it; a pointer
  // down on a viewport with no wheel target falls back to its own currentTarget.
  const surfaceRef = React.useRef<Element | null>(null);
  const wheelTargetRef = React.useRef<Element | null>(null);
  const pointersRef = React.useRef(new Map<number, Point>());
  const gestureRef = React.useRef<Gesture | null>(null);
  const spaceHeldRef = React.useRef(false);

  const clampScale = React.useCallback((value: number) => {
    if (!Number.isFinite(value)) return transformRef.current.scale;
    const { minScale: low, maxScale: high } = live.current;
    // The floor wins if a caller passes a maxScale below the fit scale, so the
    // range can never invert.
    return Math.min(Math.max(value, low), Math.max(high, low));
  }, []);

  /** Client (viewport) coordinates → container coordinates. */
  const toContainerPoint = React.useCallback((client: Point): Point => {
    const surface = surfaceRef.current;
    if (!surface) return { x: client.x, y: client.y };
    const rect = surface.getBoundingClientRect();
    return { x: client.x - rect.left, y: client.y - rect.top };
  }, []);

  const containerCentre = React.useCallback((): Point => {
    const { containerWidth: width, containerHeight: height } = live.current;
    return {
      x: (Number.isFinite(width) ? width : 0) / 2,
      y: (Number.isFinite(height) ? height : 0) / 2,
    };
  }, []);

  /** Zoom to `nextScale` keeping the content under `anchor` (container px) put. */
  const zoomAt = React.useCallback(
    (nextScale: number, anchor: Point) => {
      userAdjustedRef.current = true;
      const current = transformRef.current;
      const scale = clampScale(nextScale);
      if (scale === current.scale) return;
      if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return;
      // With c = t + p*s, the anchor stays fixed iff t' = a - (a - t) * (s'/s):
      // substituting gives c' = a(1 - r) + r*c, which is a when c is a.
      const ratio = scale / current.scale;
      commit({
        scale,
        translateX: anchor.x - (anchor.x - current.translateX) * ratio,
        translateY: anchor.y - (anchor.y - current.translateY) * ratio,
      });
    },
    [clampScale, commit],
  );

  /**
   * Shift the view by a delta in *container* pixels.
   *
   * No divide-by-scale: `translate` already lives in container space, which is
   * the space a pointer delta arrives in. Consumers of the old viewport had to
   * do that conversion by hand and got it wrong in both directions.
   */
  const panBy = React.useCallback(
    (dx: number, dy: number) => {
      userAdjustedRef.current = true;
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      if (dx === 0 && dy === 0) return;
      const current = transformRef.current;
      commit({
        scale: current.scale,
        translateX: current.translateX + dx,
        translateY: current.translateY + dy,
      });
    },
    [commit],
  );

  const fit = React.useCallback(() => {
    // Clearing the flag is half the point of the button: the user has asked for
    // the automatic framing back, so resizes should track it again.
    userAdjustedRef.current = false;
    commit(computeFitTransform(live.current));
  }, [commit]);

  const fitToRect = React.useCallback(
    (rect: { x: number; y: number; width: number; height: number }) => {
      const options = live.current;
      if (
        !isPositiveFinite(rect.width) ||
        !isPositiveFinite(rect.height) ||
        !isFittable(options)
      ) {
        return;
      }
      // Like a manual zoom: the caller framed this region deliberately, so a
      // container resize must not snap the view back to the full fit.
      userAdjustedRef.current = true;
      const availableWidth = Math.max(options.containerWidth - 2 * options.padding, 1);
      const availableHeight = Math.max(options.containerHeight - 2 * options.padding, 1);
      const scale = clampScale(
        Math.min(availableWidth / rect.width, availableHeight / rect.height),
      );
      commit({
        scale,
        translateX: options.containerWidth / 2 - scale * (rect.x + rect.width / 2),
        translateY: options.containerHeight / 2 - scale * (rect.y + rect.height / 2),
      });
    },
    [clampScale, commit],
  );

  const resetZoom = React.useCallback(() => {
    userAdjustedRef.current = true;
    const options = live.current;
    if (!isFittable(options)) {
      commit(IDENTITY);
      return;
    }
    commit({
      scale: 1,
      translateX: (options.containerWidth - options.contentWidth) / 2,
      translateY: (options.containerHeight - options.contentHeight) / 2,
    });
  }, [commit]);

  const zoomTo = React.useCallback(
    (scale: number, anchorClient?: Point) => {
      zoomAt(
        scale,
        anchorClient ? toContainerPoint(anchorClient) : containerCentre(),
      );
    },
    [zoomAt, toContainerPoint, containerCentre],
  );

  const zoomBy = React.useCallback(
    (factor: number, anchorClient?: Point) => {
      if (!isPositiveFinite(factor)) return;
      zoomTo(transformRef.current.scale * factor, anchorClient);
    },
    [zoomTo],
  );

  const handleWheel = React.useCallback(
    (event: WheelEvent) => {
      // Bound {passive:false} precisely so this wins over page scroll and over
      // the browser's own ctrl+wheel page zoom.
      event.preventDefault();
      const { wheelMode: mode, containerHeight: height } = live.current;
      const delta = normaliseWheelDelta(event, height);

      // ctrl/meta is what a trackpad pinch reports, so laptop pinch-to-zoom
      // lands here with no extra plumbing.
      if (event.ctrlKey || event.metaKey || mode === "zoom") {
        const factor = Math.exp(-delta.y * WHEEL_ZOOM_SPEED);
        zoomAt(
          transformRef.current.scale * factor,
          toContainerPoint({ x: event.clientX, y: event.clientY }),
        );
        return;
      }
      if (event.shiftKey) {
        // Shift is the horizontal-scroll convention. A plain mouse has only one
        // wheel axis and reports it in deltaY, so fall back to that.
        panBy(-(delta.x !== 0 ? delta.x : delta.y), 0);
        return;
      }
      panBy(-delta.x, -delta.y);
    },
    [zoomAt, panBy, toContainerPoint],
  );

  // A stable listener that forwards to the latest handler. removeEventListener
  // needs the exact function that was added, and `attachWheel` only rebinds when
  // the *element* changes — so the bound function must never change identity.
  const handleWheelRef = React.useRef(handleWheel);
  useIsomorphicLayoutEffect(() => {
    handleWheelRef.current = handleWheel;
  });
  // Typed as a plain EventListener because the target is
  // `HTMLElement | SVGElement`: on that union TypeScript falls back to the
  // `Element` overload, whose event map has no "wheel" entry, so a
  // `(e: WheelEvent) => void` is rejected. The cast is safe — only "wheel" is
  // ever registered with this listener.
  const wheelListener = React.useRef<EventListener>((event: Event) =>
    handleWheelRef.current(event as WheelEvent),
  ).current;

  const attachWheel = React.useCallback(
    (element: HTMLElement | SVGElement | null) => {
      const previous = wheelTargetRef.current;
      if (previous === element) return;
      if (previous) previous.removeEventListener("wheel", wheelListener);
      wheelTargetRef.current = element;
      surfaceRef.current = element;
      // passive:false is mandatory: browsers default wheel listeners on scroll
      // containers to passive, where preventDefault() is a silent no-op.
      if (element) {
        element.addEventListener("wheel", wheelListener, { passive: false });
      }
    },
    [wheelListener],
  );

  React.useEffect(() => {
    return () => {
      const target = wheelTargetRef.current;
      if (target) target.removeEventListener("wheel", wheelListener);
      wheelTargetRef.current = null;
      surfaceRef.current = null;
    };
  }, [wheelListener]);

  // Space-to-pan. Tracked on the window because the canvas is not focusable and
  // the user's hand is on the mouse, over the canvas, not on a focused element.
  React.useEffect(() => {
    const setHeld = (held: boolean) => {
      spaceHeldRef.current = held;
      setIsSpaceHeld(held);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      // Never steal the space bar from a field being typed into, or from a
      // shortcut combination that merely happens to include it.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTextEntry(event.target)) return;
      // Space scrolls the page and activates the focused button; a pan gesture
      // needs it to do neither. Repeats are prevented too, or holding space
      // fires the button once per repeat.
      event.preventDefault();
      if (!spaceHeldRef.current) setHeld(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      setHeld(false);
    };
    // Alt-tabbing away mid-hold would otherwise leave the flag stuck on.
    const onBlur = () => setHeld(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const onPointerDown = React.useCallback(
    (event: React.PointerEvent) => {
      if (!surfaceRef.current) surfaceRef.current = event.currentTarget;
      const pointers = pointersRef.current;
      const isTouch = event.pointerType === "touch";
      const isPrimaryButton = event.button === 0;
      const startsPan =
        event.button === 1 || // middle-drag: the universal pan chord
        (isPrimaryButton && (event.shiftKey || spaceHeldRef.current)) ||
        (isPrimaryButton && live.current.panEnabled);

      // Touch pointers are implicitly captured by the browser, so their
      // up/cancel always comes back here; tracking every one of them is what
      // lets a two-finger pinch work even while a drawing tool owns one-finger
      // input. A mouse pointer that starts no gesture is left untracked, since
      // its release can land anywhere and would strand a phantom entry here.
      if (!startsPan && !isTouch) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointers.size >= 2) {
        if (gestureRef.current?.kind !== "pinch") {
          const entries = [...pointers.entries()];
          const [idA, a] = entries[0];
          const [idB, b] = entries[1];
          gestureRef.current = {
            kind: "pinch",
            pointerIds: [idA, idB],
            lastDistance: Math.hypot(b.x - a.x, b.y - a.y),
            lastMidX: (a.x + b.x) / 2,
            lastMidY: (a.y + b.y) / 2,
          };
          setIsPanning(true);
        }
        capturePointer(event.currentTarget, event.pointerId);
        return;
      }

      if (!startsPan) return;
      // Middle-drag: suppress the autoscroll widget. Left-drag: suppress text
      // selection and the browser's native image drag.
      event.preventDefault();
      gestureRef.current = {
        kind: "pan",
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
      };
      capturePointer(event.currentTarget, event.pointerId);
      setIsPanning(true);
    },
    [],
  );

  const onPointerMove = React.useCallback(
    (event: React.PointerEvent) => {
      const pointers = pointersRef.current;
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      const gesture = gestureRef.current;
      if (!gesture) return;

      if (gesture.kind === "pan") {
        if (gesture.pointerId !== event.pointerId) return;
        panBy(event.clientX - gesture.lastX, event.clientY - gesture.lastY);
        gesture.lastX = event.clientX;
        gesture.lastY = event.clientY;
        return;
      }

      const [idA, idB] = gesture.pointerIds;
      const a = pointers.get(idA);
      const b = pointers.get(idB);
      if (!a || !b) return;
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;

      // Two-finger pan first, then zoom about where the fingers now are, so the
      // content under the midpoint stays put across the whole gesture.
      panBy(midX - gesture.lastMidX, midY - gesture.lastMidY);
      if (gesture.lastDistance > 0 && distance > 0) {
        zoomAt(
          transformRef.current.scale * (distance / gesture.lastDistance),
          toContainerPoint({ x: midX, y: midY }),
        );
      }
      gesture.lastDistance = distance;
      gesture.lastMidX = midX;
      gesture.lastMidY = midY;
    },
    [panBy, zoomAt, toContainerPoint],
  );

  const onPointerEnd = React.useCallback((event: React.PointerEvent) => {
    const pointers = pointersRef.current;
    const wasTracked = pointers.delete(event.pointerId);
    releasePointer(event.currentTarget, event.pointerId);
    if (!wasTracked) return;

    const gesture = gestureRef.current;
    if (!gesture) return;
    const involved =
      gesture.kind === "pan"
        ? gesture.pointerId === event.pointerId
        : gesture.pointerIds.includes(event.pointerId);
    if (!involved) return;

    if (gesture.kind === "pinch") {
      // Lifting one finger of a pinch continues as a one-finger pan rather than
      // ending the gesture, which would jump on the next move.
      const survivor = gesture.pointerIds.find((id) => pointers.has(id));
      const point = survivor === undefined ? undefined : pointers.get(survivor);
      if (survivor !== undefined && point) {
        gestureRef.current = {
          kind: "pan",
          pointerId: survivor,
          lastX: point.x,
          lastY: point.y,
        };
        return;
      }
    }
    gestureRef.current = null;
    setIsPanning(false);
  }, []);

  const handlers = React.useMemo<ViewportPointerHandlers>(
    () => ({
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
    }),
    [onPointerDown, onPointerMove, onPointerEnd],
  );

  return React.useMemo<ViewportTransformApi>(
    () => ({
      transform,
      fitScale,
      isPanning,
      isSpaceHeld,
      fit,
      fitToRect,
      resetZoom,
      zoomBy,
      zoomTo,
      handlers,
      attachWheel,
    }),
    [
      transform,
      fitScale,
      isPanning,
      isSpaceHeld,
      fit,
      fitToRect,
      resetZoom,
      zoomBy,
      zoomTo,
      handlers,
      attachWheel,
    ],
  );
}
