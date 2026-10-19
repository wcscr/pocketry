import type { ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "./dropdown-menu";

export interface ContextMenuPoint { x: number; y: number }

/** The normal menu primitive, anchored to a pointer or keyboard context request. */
export function PointerContextMenu({ point, title, onClose, onRestoreFocus, children }: {
  point: ContextMenuPoint | null;
  title: string;
  onClose: () => void;
  onRestoreFocus?: () => void;
  children: ReactNode;
}): JSX.Element {
  return <DropdownMenu open={!!point} onOpenChange={open => { if (!open) onClose(); }} modal={false}>
    <DropdownMenuTrigger asChild><button type="button" tabIndex={-1} aria-hidden="true"
      className="pointer-events-none fixed h-px w-px opacity-0" style={{ left: point?.x ?? 0, top: point?.y ?? 0 }} /></DropdownMenuTrigger>
    <DropdownMenuContent align="start" sideOffset={0} collisionPadding={8} aria-label={`${title} actions`}
      className="max-h-[var(--radix-dropdown-menu-content-available-height)] max-w-[calc(100vw-1rem)] overflow-y-auto [@media(pointer:coarse)]:[&_[role=menuitem]]:min-h-11"
      onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus?.(); }}>
      <DropdownMenuLabel className="max-w-64 truncate">{title}</DropdownMenuLabel>
      {children}
    </DropdownMenuContent>
  </DropdownMenu>;
}

/** Keyboard context-menu requests have no pointer coordinates. */
export function contextMenuPoint(event: { clientX: number; clientY: number; currentTarget: EventTarget | null }): ContextMenuPoint {
  if (event.clientX || event.clientY || !(event.currentTarget instanceof Element)) return { x: event.clientX, y: event.clientY };
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.left + Math.min(20, rect.width / 2), y: rect.top + Math.min(20, rect.height / 2) };
}

/** Keep native editing menus inside name fields and inline text editors. */
export function usesNativeEditingMenu(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest("input, textarea, select, [contenteditable=true]");
}
