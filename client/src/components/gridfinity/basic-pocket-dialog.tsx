import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BASIC_POCKET_LABELS, createBasicPocket, type BasicPocketShape } from "@/lib/gridfinity/basic-shape";
import { useBin } from "@/state/bin-store";
import { useShapeLibrary } from "@/state/shape-library";
import { useKeyboardViewport } from "@/hooks/use-keyboard-viewport";

/** Optional exact dimensions use the same shape factory and placement history
 * as drawing. Nothing is added to the library until the user submits.
 */
export function BasicPocketDialog({ kind, onClose, onDraw }: {
  kind: BasicPocketShape; onClose: () => void; onDraw: () => void;
}) {
  const { spec, dispatch } = useBin();
  const { storeShape } = useShapeLibrary();
  const keyboard = useKeyboardViewport();
  const [width, setWidth] = useState("30");
  const [length, setLength] = useState("50");
  const [depth, setDepth] = useState(String(Math.min(12, spec.heightUnits * 7 - 1)));
  const number = (value: string) => Number(value.trim().replace(",", "."));
  const w = number(width), l = kind === "rectangle" ? number(length) : w, d = number(depth);
  // Bound the input before generating a circle's tessellated contour.
  const valid = [w, l].every(value => Number.isFinite(value) && value >= 1 && value <= 2000)
    && Number.isFinite(d) && d > 0 && d <= spec.heightUnits * 7;
  const add = () => {
    if (!valid) return;
    const pocket = createBasicPocket(kind, kind === "circle" ? { x: 0, y: 0 } : { x: -w / 2, y: -l / 2 },
      { x: w / 2, y: kind === "circle" ? 0 : l / 2 }, crypto.randomUUID());
    if (!pocket) return;
    storeShape(pocket.shape);
    dispatch({ type: "ADD_PLACED", cutouts: [{ ...pocket.cutout, depth: { mode: "mm", value: d } }],
      gridX: spec.gridX, gridY: spec.gridY, historyLabel: `Add ${kind} pocket` });
    dispatch({ type: "SET_VIEW_MODE", viewMode: "2d" });
    dispatch({ type: "SET_EDITOR_MODE", editorMode: "placement" });
    onClose();
  };
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-w-sm" onOpenAutoFocus={event => event.preventDefault()}
      style={keyboard ? { top: keyboard.top + keyboard.height / 2, maxHeight: Math.max(1, keyboard.height - 32) } : undefined}>
      <DialogHeader><DialogTitle>Add {BASIC_POCKET_LABELS[kind].toLowerCase()} pocket</DialogTitle>
        <DialogDescription>Enter dimensions or draw on the canvas.</DialogDescription></DialogHeader>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); add(); }}>
        <label className="block space-y-1 text-sm">{kind === "circle" ? "Diameter" : kind === "square" ? "Side" : "Width"} (mm)
          <Input inputMode="decimal" enterKeyHint="next" value={width} onChange={event => setWidth(event.target.value)} /></label>
        {kind === "rectangle" && <label className="block space-y-1 text-sm">Length (mm)
          <Input inputMode="decimal" enterKeyHint="next" value={length} onChange={event => setLength(event.target.value)} /></label>}
        <label className="block space-y-1 text-sm">Depth (mm)
          <Input inputMode="decimal" enterKeyHint="done" value={depth} onChange={event => setDepth(event.target.value)} /></label>
        {!valid && <p role="status" className="text-xs text-destructive">Use dimensions from 1 to 2000 mm and a positive depth up to {spec.heightUnits * 7} mm.</p>}
        <Button type="submit" className="min-h-11 w-full" disabled={!valid}>Place in center</Button>
        <Button type="button" variant="outline" className="min-h-11 w-full" onClick={onDraw}>Draw on canvas</Button>
      </form>
    </DialogContent>
  </Dialog>;
}
