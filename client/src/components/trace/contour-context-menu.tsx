import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { Settings2, Spline, Trash2 } from "lucide-react";
import { OUTER_RING, type Outline, type RingRef } from "@shared/geometry/types";
import { getRing, removeRing, setRing } from "@/lib/geometry/outline";
import { useTrace } from "@/state/trace-store";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { PointerContextMenu, type ContextMenuPoint } from "@/components/ui/pointer-context-menu";

const ContourMenuContext = createContext<((ref: RingRef, point: ContextMenuPoint, vertex?: number) => boolean) | null>(null);
export const useContourContextMenu = () => useContext(ContourMenuContext);

/** Holes are retained-material contours, including those produced by PR 166. */
export function ContourMenuProvider({ children, onProperties, onEdit }: {
  children: ReactNode; onProperties?: () => void; onEdit?: () => void;
}): JSX.Element {
  const trace = useTrace();
  const [menu, setMenu] = useState<{ ref: RingRef; vertex?: number; outline: Outline; point: ContextMenuPoint } | null>(null);
  const focusBefore = useRef<HTMLElement | null>(null);
  const ring = menu && menu.outline === trace.outline ? getRing(trace.outline, menu.ref) : null;
  const isOuter = menu?.ref.ringIndex === OUTER_RING;
  const title = menu ? isOuter ? `Shape ${menu.ref.shapeIndex + 1}` : `Hole ${menu.ref.ringIndex + 1} of shape ${menu.ref.shapeIndex + 1}` : "Contour";
  const open = (ref: RingRef, point: ContextMenuPoint, vertex?: number) => {
    if (trace.processing || !getRing(trace.outline, ref)) return false;
    focusBefore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    trace.dispatch({ type: "SELECT_RING", selection: ref });
    setMenu({ ref, point, vertex, outline: trace.outline }); return true;
  };
  const edit = () => { trace.dispatch({ type: "SET_MODE", mode: "edit" }); onEdit?.(); };
  return <ContourMenuContext.Provider value={open}>
    {children}
    <PointerContextMenu point={ring ? menu!.point : null} title={title} onClose={() => setMenu(null)} onRestoreFocus={() => focusBefore.current?.focus()}>
      <DropdownMenuItem className="min-h-9 gap-2" onSelect={onProperties ?? edit}><Settings2 className="h-4 w-4" />Properties</DropdownMenuItem>
      <DropdownMenuItem className="min-h-9 gap-2" onSelect={edit}><Spline className="h-4 w-4" />Edit contour</DropdownMenuItem>
      {menu?.vertex !== undefined && <DropdownMenuItem className="min-h-9 gap-2" disabled={!ring || ring.length <= 3} onSelect={() => {
        if (!menu || !ring || ring.length <= 3) return;
        trace.dispatch({ type: "OUTLINE_COMMITTED", outline: setRing(trace.outline, menu.ref, ring.filter((_, index) => index !== menu.vertex)), label: "Remove contour node" });
      }}>Remove contour node</DropdownMenuItem>}
      <DropdownMenuSeparator />
      <DropdownMenuItem className="min-h-9 gap-2 text-destructive focus:text-destructive" disabled={isOuter && trace.outline.length <= 1} onSelect={() => {
        if (!menu || !ring || isOuter && trace.outline.length <= 1) return;
        trace.dispatch({ type: "OUTLINE_COMMITTED", outline: removeRing(trace.outline, menu.ref), label: isOuter ? "Remove tool shape" : "Remove interior hole" });
        trace.dispatch({ type: "SELECT_RING", selection: null });
      }}><Trash2 className="h-4 w-4" />{isOuter ? "Remove shape" : "Remove hole"}</DropdownMenuItem>
    </PointerContextMenu>
  </ContourMenuContext.Provider>;
}
