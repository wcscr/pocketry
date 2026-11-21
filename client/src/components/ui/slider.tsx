import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

const TOUCH_DRAG_SLOP_PX = 8;

interface TouchGesture {
  pointerId: number;
  startX: number;
  startY: number;
  startValue: number;
  currentValue: number;
  startedOnThumb: boolean;
  intent: "pending" | "horizontal" | "vertical";
  captureTarget: HTMLElement | null;
}

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
    /** Fill a signed horizontal control from zero, with a neutral-position tick. */
    centerOrigin?: boolean;
    /** Allow vertical touch scrolling and roll back canceled drags; only use when live changes stay in draft state until commit. */
    touchScrollGuard?: boolean;
  }
>(({
  className,
  centerOrigin = false,
  touchScrollGuard = false,
  value,
  defaultValue,
  onValueChange,
  onValueCommit,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  ...props
}, ref) => {
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  const step = props.step ?? 1;
  const isHorizontal = props.orientation !== "vertical";
  const isControlled = value !== undefined;
  const [uncontrolledValue, setUncontrolledValue] = React.useState<number[]>(
    () => defaultValue ?? [min]
  );
  const values = isControlled ? value : uncontrolledValue;
  const currentValue = values[0] ?? min;
  const rootRef = React.useRef<HTMLSpanElement | null>(null);
  const thumbRef = React.useRef<HTMLSpanElement | null>(null);
  const touchGesture = React.useRef<TouchGesture | null>(null);

  const setRootRef = React.useCallback((node: HTMLSpanElement | null) => {
    rootRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  }, [ref]);

  const emitChange = React.useCallback((next: number) => {
    if (!isControlled) setUncontrolledValue([next]);
    onValueChange?.([next]);
  }, [isControlled, onValueChange]);

  const valueFromClientX = React.useCallback((clientX: number, rect: DOMRect): number => {
    if (rect.width <= 0) return currentValue;
    const isRtl = props.dir === "rtl" || (rootRef.current ? getComputedStyle(rootRef.current).direction === "rtl" : false);
    const isSlidingFromLeft = isRtl ? !!props.inverted : !props.inverted;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const raw = isSlidingFromLeft ? min + ratio * (max - min) : max - ratio * (max - min);
    const decimalCount = (String(step).split(".")[1] || "").length;
    const snapped = Math.round((raw - min) / step) * step + min;
    const factor = 10 ** decimalCount;
    const rounded = Math.round(snapped * factor) / factor;
    return Math.max(min, Math.min(max, rounded));
  }, [currentValue, max, min, props.dir, props.inverted, step]);

  const cancelTouchGesture = React.useCallback(() => {
    const gesture = touchGesture.current;
    if (!gesture) return;
    touchGesture.current = null;
    if (gesture.captureTarget?.hasPointerCapture?.(gesture.pointerId)) {
      try { gesture.captureTarget.releasePointerCapture(gesture.pointerId); } catch {}
    }
    if (gesture.currentValue !== gesture.startValue) {
      emitChange(gesture.startValue);
    }
  }, [emitChange]);

  const position = (v: number) => Math.max(0, Math.min(100, (v - min) / (max - min) * 100));
  const zero = position(0);
  const current = position(currentValue);

  const interceptHorizontalTouch = touchScrollGuard && isHorizontal && !props.disabled && values.length <= 1;

  return (
  <SliderPrimitive.Root
    ref={setRootRef}
    className={cn(
      "relative flex w-full select-none items-center",
      touchScrollGuard ? (isHorizontal ? "touch-pan-y" : "touch-pan-x") : "touch-none",
      className
    )}
    value={values}
    onValueChange={(next) => {
      if (!isControlled) setUncontrolledValue(next);
      onValueChange?.(next);
    }}
    onValueCommit={onValueCommit}
    onPointerDown={(event) => {
      onPointerDown?.(event);
      if (!interceptHorizontalTouch || event.pointerType !== "touch") return;
      // Defer touch slides until horizontal intent is clear so vertical scrolls
      // over the track or thumb never mutate the slider value.
      event.preventDefault();
      if (touchGesture.current) {
        cancelTouchGesture();
        return;
      }
      const startedOnThumb = event.target instanceof Element && Boolean(event.target.closest('[role="slider"]'));
      touchGesture.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startValue: currentValue,
        currentValue,
        startedOnThumb,
        intent: "pending",
        captureTarget: null,
      };
    }}
    onPointerMove={(event) => {
      onPointerMove?.(event);
      const gesture = touchGesture.current;
      if (!gesture || event.pointerType !== "touch" || gesture.pointerId !== event.pointerId) return;
      event.preventDefault();
      if (gesture.intent === "vertical") return;
      if (gesture.intent === "pending") {
        const dx = event.clientX - gesture.startX;
        const dy = event.clientY - gesture.startY;
        if (Math.hypot(dx, dy) < TOUCH_DRAG_SLOP_PX) return;
        if (Math.abs(dy) >= Math.abs(dx)) {
          gesture.intent = "vertical";
          return;
        }
        gesture.intent = "horizontal";
        try {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          gesture.captureTarget = event.currentTarget;
        } catch {}
        thumbRef.current?.focus();
      }
      const next = valueFromClientX(event.clientX, event.currentTarget.getBoundingClientRect());
      if (next !== gesture.currentValue) {
        gesture.currentValue = next;
        emitChange(next);
      }
    }}
    onPointerUp={(event) => {
      onPointerUp?.(event);
      const gesture = touchGesture.current;
      if (!gesture || event.pointerType !== "touch" || gesture.pointerId !== event.pointerId) return;
      event.preventDefault();
      touchGesture.current = null;
      if (gesture.captureTarget?.hasPointerCapture?.(event.pointerId)) {
        try { gesture.captureTarget.releasePointerCapture(event.pointerId); } catch {}
      }
      if (gesture.intent === "vertical") return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (gesture.intent === "horizontal") {
        const finalValue = valueFromClientX(event.clientX, rect);
        if (finalValue !== gesture.currentValue) {
          gesture.currentValue = finalValue;
          emitChange(finalValue);
        }
        if (finalValue !== gesture.startValue) {
          onValueCommit?.([finalValue]);
        }
        return;
      }
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      if (Math.hypot(dx, dy) >= TOUCH_DRAG_SLOP_PX) return;
      thumbRef.current?.focus();
      if (gesture.startedOnThumb) return;
      const tappedValue = valueFromClientX(event.clientX, rect);
      if (tappedValue !== gesture.startValue) {
        emitChange(tappedValue);
        onValueCommit?.([tappedValue]);
      }
    }}
    onPointerCancel={(event) => {
      onPointerCancel?.(event);
      if (touchGesture.current?.pointerId === event.pointerId) cancelTouchGesture();
    }}
    onLostPointerCapture={(event) => {
      onLostPointerCapture?.(event);
      // Touch starts with implicit capture on the thumb/track; transferring
      // capture to the root fires a bubbling lostpointercapture on that child.
      if (
        touchGesture.current?.pointerId === event.pointerId &&
        touchGesture.current.captureTarget === event.target
      ) {
        cancelTouchGesture();
      }
    }}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary">
      {centerOrigin ? <>
        <span className="absolute h-full bg-primary" style={{ left: `${Math.min(zero, current)}%`, width: `${Math.abs(current - zero)}%` }} />
        <span className="absolute h-full w-px bg-foreground/50" style={{ left: `${zero}%` }} />
      </> : <SliderPrimitive.Range className="absolute h-full bg-primary" />}
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb ref={thumbRef} aria-label={props["aria-label"]} aria-labelledby={props["aria-labelledby"]} className="block h-5 w-5 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50" />
  </SliderPrimitive.Root>
  )
})
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
