import { useSyncExternalStore } from "react";

function snapshot(): string {
  const viewport = window.visualViewport;
  const input = document.activeElement?.matches("input, textarea, [contenteditable=true]");
  return viewport && input && viewport.scale === 1
    ? JSON.stringify([viewport.height, viewport.offsetTop, document.activeElement?.id ?? ""]) : "";
}
function subscribe(notify: () => void) {
  const viewport = window.visualViewport;
  viewport?.addEventListener("resize", notify);
  viewport?.addEventListener("scroll", notify);
  document.addEventListener("focusin", notify);
  document.addEventListener("focusout", notify);
  return () => {
    viewport?.removeEventListener("resize", notify);
    viewport?.removeEventListener("scroll", notify);
    document.removeEventListener("focusin", notify);
    document.removeEventListener("focusout", notify);
  };
}

/** Keep actions above a soft keyboard without changing the workspace layout.
 * The visual viewport also accounts for browser focus scroll.
 */
export function useKeyboardViewport() {
  const value = useSyncExternalStore(subscribe, snapshot, () => "");
  if (!value) return undefined;
  const [height, top, focusedId] = JSON.parse(value) as [number, number, string];
  return { height, top, focusedId };
}
