/** TransformControls treats every pointer as the drag's owner. Keep multi-touch
 * navigation out of that controller, including the final finger's release. */
export function guardTransformTouches(
  element: HTMLElement,
  control: { enabled: boolean },
  cancel: () => void,
): () => void {
  const document = element.ownerDocument;
  const touches = new Map<number, PointerEvent>();
  let navigating = false;
  let replaying = false;
  let enabled = control.enabled;

  // OrbitControls may have missed the first down while a gizmo disabled it.
  // Balance that contact, then seed its current position before the second down.
  const replay = (type: "pointerdown" | "pointerup", event: PointerEvent) => {
    replaying = true;
    try {
      element.dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerType: "touch", pointerId: event.pointerId,
        clientX: event.clientX, clientY: event.clientY, button: 0,
        buttons: type === "pointerdown" ? 1 : 0,
      }));
    } finally { replaying = false; }
  };
  const down = (event: PointerEvent) => {
    if (replaying || event.pointerType !== "touch") return;
    if (!touches.size) enabled = control.enabled;
    touches.set(event.pointerId, event);
    if (touches.size < 2 || navigating) return;
    navigating = true;
    control.enabled = false;
    cancel();
    for (const touch of touches.values()) if (touch.pointerId !== event.pointerId) {
      replay("pointerup", touch);
      replay("pointerdown", touch);
    }
  };
  const move = (event: PointerEvent) => {
    if (!replaying && touches.has(event.pointerId)) touches.set(event.pointerId, event);
  };
  const end = (event: PointerEvent) => {
    if (replaying || !touches.delete(event.pointerId)) return;
    if (event.type === "pointercancel") {
      cancel();
      // Orbit listens for cancellation only on the canvas, while a captured
      // contact may be canceled elsewhere. Balance it at the document too.
      replay("pointerup", event);
    }
  };
  // Run after the controllers' document listeners, so the final release cannot
  // resurrect the canceled edit. A new gesture may use the handles again.
  const release = () => {
    if (!replaying && !touches.size && navigating) {
      navigating = false;
      control.enabled = enabled;
    }
  };
  const reset = () => {
    control.enabled = false;
    cancel();
    for (const touch of touches.values()) replay("pointerup", touch);
    touches.clear();
    navigating = false;
    control.enabled = enabled;
  };
  element.addEventListener("pointerdown", down, true);
  document.addEventListener("pointermove", move, true);
  document.addEventListener("pointerup", end, true);
  document.addEventListener("pointercancel", end, true);
  document.addEventListener("pointerup", release);
  document.addEventListener("pointercancel", release);
  window.addEventListener("blur", reset);
  return () => {
    reset();
    element.removeEventListener("pointerdown", down, true);
    document.removeEventListener("pointermove", move, true);
    document.removeEventListener("pointerup", end, true);
    document.removeEventListener("pointercancel", end, true);
    document.removeEventListener("pointerup", release);
    document.removeEventListener("pointercancel", release);
    window.removeEventListener("blur", reset);
  };
}
