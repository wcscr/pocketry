import { useSyncExternalStore } from "react";

/** Compact windows, plus short touch viewports in phone landscape. Full-size
 * tablets keep the resizable layout. Input targets may still be touch sized.
 */
export const MOBILE_LAYOUT_QUERY = "(max-width: 767px), (any-pointer: coarse) and (max-width: 1023px) and (max-height: 599px)";
const TOUCH_QUERY = "(any-pointer: coarse)";

function subscribeQuery(query: string, notify: () => void) {
  const media = window.matchMedia?.(query);
  media?.addEventListener("change", notify);
  return () => media?.removeEventListener("change", notify);
}
const subscribeTouch = (notify: () => void) => subscribeQuery(TOUCH_QUERY, notify);
const touchSnapshot = () => window.matchMedia?.(TOUCH_QUERY).matches ?? false;

/** Separate from the layout decision: tablets and mixed-input devices need
 * roomy controls even when there is enough space for a desktop sidebar.
 */
export function useHasTouchInput(): boolean {
  return useSyncExternalStore(subscribeTouch, touchSnapshot, () => false);
}

let lastLayout: boolean | undefined;
let keyboardLayout: boolean | undefined;
let releaseKeyboard: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const typing = () => document.activeElement?.matches("input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, [contenteditable=true]") ?? false;
const notify = () => { for (const listener of listeners) listener(); };

export function getMobileLayoutSnapshot(): boolean {
  // A soft keyboard must not turn a tablet into a phone layout or remount an
  // input. Keep the pre-keyboard choice through the closing animation.
  if (keyboardLayout !== undefined) return keyboardLayout;
  lastLayout = window.matchMedia?.(MOBILE_LAYOUT_QUERY).matches ?? false;
  return lastLayout;
}
function focusChanged() {
  clearTimeout(releaseKeyboard);
  if (typing()) {
    keyboardLayout ??= lastLayout ?? getMobileLayoutSnapshot();
  } else {
    releaseKeyboard = setTimeout(() => { keyboardLayout = undefined; notify(); }, 300);
  }
}
function subscribeLayout(listener: () => void) {
  listeners.add(listener);
  const unsubscribe = subscribeQuery(MOBILE_LAYOUT_QUERY, listener);
  if (listeners.size === 1) {
    document.addEventListener("focusin", focusChanged);
    document.addEventListener("focusout", focusChanged);
  }
  return () => {
    unsubscribe();
    listeners.delete(listener);
    if (!listeners.size) {
      document.removeEventListener("focusin", focusChanged);
      document.removeEventListener("focusout", focusChanged);
      clearTimeout(releaseKeyboard);
      keyboardLayout = undefined;
      lastLayout = undefined;
    }
  };
}

/** Reads the actual media query on the first client render, before panels mount. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribeLayout, getMobileLayoutSnapshot, () => false);
}
