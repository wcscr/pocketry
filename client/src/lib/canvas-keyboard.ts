const INTERACTIVE_TARGETS = [
  "button", "a[href]", "input", "textarea", "select", "summary",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]', '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
  '[role="slider"]', '[role="spinbutton"]', '[role="textbox"]', '[role="combobox"]',
  '[role="tab"]', '[role="tablist"]', '[role="option"]', '[role="treeitem"]',
  '[role="menuitem"]', '[role="menuitemcheckbox"]', '[role="menuitemradio"]',
  '[role="status"][tabindex]',
].join(",");

const KEYBOARD_LAYERS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="menubar"], [role="listbox"], dialog[open]';

function isOpenLayer(layer: Element): boolean {
  if (layer.closest('[hidden], [inert], [aria-hidden="true"], [data-state="closed"]')) return false;
  // Checking ancestors also excludes CSS-hidden retained panels. Geometry is
  // not used: an opening dialog can own input before its first layout frame.
  for (let element: Element | null = layer; element; element = element.parentElement) {
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    if (style?.display === "none" || style?.visibility === "hidden") return false;
  }
  return true;
}

/** Window-level canvas commands must not consume another control's keyboard input. */
export function canHandleCanvasShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  const target = event.target instanceof Element ? event.target : document.activeElement;
  const control = target?.closest(INTERACTIVE_TARGETS);
  // A plain button has no native Escape action. Keep Esc-to-exit available
  // after clicking a canvas tool; an open dialog/menu still wins below.
  const buttonEscape = event.key === "Escape" && control?.matches('button:not([role]), button[role="button"]');
  // Command shortcuts have no native editing meaning on these controls.
  // Keep unmodified keys and text-entry/composite widgets with their owner.
  const command = (event.ctrlKey || event.metaKey) && !event.altKey &&
    ["z", "y", "d", "a"].includes(event.key.toLowerCase());
  const commandControl = command && control?.matches([
    'button:not([role])', '[role="button"]', '[role="tab"]',
    '[role="switch"]', '[role="checkbox"]', '[role="radio"]',
  ].join(",")) && !target?.closest('[contenteditable]:not([contenteditable="false"])');
  if (control && !buttonEscape && !commandControl) return false;
  const owner = target?.ownerDocument ?? document;
  return !Array.from(owner.querySelectorAll(KEYBOARD_LAYERS)).some(isOpenLayer);
}
