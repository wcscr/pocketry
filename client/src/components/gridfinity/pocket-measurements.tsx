import { outlineBounds } from "@/lib/geometry/outline";
import { useState } from "react";
import { placementFootprint, resolvePocketDepth, type CutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { binTotalHeightMm } from "@shared/gridfinity/standard";
import { Button } from "@/components/ui/button";
import { DraftNumberInput } from "@/components/ui/draft-number-input";
import { Label } from "@/components/ui/label";
import { useBin } from "@/state/bin-store";
import { useShapeLibrary } from "@/state/shape-library";
import type { BuildBinSection } from "@/lib/gridfinity/worker-api";

/** Coordinates are the same centre-origin, y-up millimetres used by the canvas. */
export function PositionInputs({ position, onChange }: {
  position: { x: number; y: number };
  onChange: (position: { x: number; y: number }, transient: boolean) => void;
}): JSX.Element {
  return <div className="space-y-1.5">
    <p className="text-xs font-medium">Position from bin centre (mm)</p>
    <div className="flex gap-2">{(["x", "y"] as const).map((axis) => <Label key={axis} className="flex flex-1 items-center gap-2 text-xs">
      {axis.toUpperCase()}
      <DraftNumberInput aria-label={`${axis.toUpperCase()} position in millimetres`} className="h-8 min-w-0" value={position[axis]} displayPrecision={2} step={0.5}
        onValueChange={(value) => onChange({ ...position, [axis]: value }, true)}
        onValueCommit={(value) => onChange({ ...position, [axis]: value }, false)} />
    </Label>)}</div>
    <p className="text-[11px] text-muted-foreground">Positive X is right; positive Y is up.</p>
  </div>;
}

export function PocketMeasurements({ cutout, shape, setScale, inspect }: {
  cutout: CutoutPlacement; shape: TracedShape;
  setScale: (axis: "x" | "y", percent: number) => void;
  inspect: (section: BuildBinSection) => void;
}): JSX.Element {
  const { spec, cutouts, dispatch } = useBin();
  const { shapes } = useShapeLibrary();
  const [neighborId, setNeighborId] = useState("");
  const [side, setSide] = useState<"right" | "left" | "above" | "below">("right");
  const [gap, setGap] = useState(3);
  const pocket = resolvePocketDepth(spec, cutout.depth);
  const total = binTotalHeightMm(spec.heightUnits, spec.lip === "standard");
  const updatePosition = (position: CutoutPlacement["position"], transient = false) => dispatch({ type: "UPDATE_CUTOUT", id: cutout.id, patch: { position }, transient, historyLabel: "Position tool pocket" });
  const bounds = outlineBounds(placementFootprint(shape, cutout).outline)!;
  const neighbor = cutouts.find((item) => item.id === neighborId && item.id !== cutout.id);
  const neighborShape = shapes.find((item) => item.id === neighbor?.shapeId);
  const spaceFromNeighbor = () => {
    if (!neighbor || !neighborShape) return;
    const target = outlineBounds(placementFootprint(neighborShape, neighbor).outline)!;
    // Mouth-to-mouth spacing includes clearance and the top edge round.
    const allowance = cutout.clearanceMm + cutout.topFilletMm + neighbor.clearanceMm + neighbor.topFilletMm + gap;
    const dx = side === "right" ? target.maxX + allowance - bounds.minX : side === "left" ? target.minX - allowance - bounds.maxX : 0;
    const dy = side === "above" ? target.maxY + allowance - bounds.minY : side === "below" ? target.minY - allowance - bounds.maxY : 0;
    updatePosition({ x: cutout.position.x + dx, y: cutout.position.y + dy });
  };
  return <div className="space-y-3">
    <PositionInputs position={cutout.position} onChange={updatePosition} />
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={() => updatePosition({ ...cutout.position, x: cutout.position.x - (bounds.minX + bounds.maxX) / 2 })}>Centre X</Button>
      <Button variant="outline" size="sm" onClick={() => updatePosition({ ...cutout.position, y: cutout.position.y - (bounds.minY + bounds.maxY) / 2 })}>Centre Y</Button>
    </div>
    {cutouts.length > 1 && <details className="space-y-2 text-xs">
      <summary className="cursor-pointer">Space beside another pocket</summary>
      <select className="h-8 w-full rounded border bg-background px-2" aria-label="Reference pocket" value={neighborId} onChange={(event) => setNeighborId(event.target.value)}>
        <option value="">Choose a pocket</option>
        {cutouts.filter((item) => item.id !== cutout.id).map((item) => <option key={item.id} value={item.id}>{shapes.find((shape) => shape.id === item.shapeId)?.name ?? "Pocket"}</option>)}
      </select>
      <div className="flex gap-2">
        <select aria-label="Side of reference pocket" className="rounded border bg-background" value={side} onChange={(event) => setSide(event.target.value as typeof side)}>
          <option value="right">Right</option><option value="left">Left</option><option value="above">Above</option><option value="below">Below</option>
        </select>
        <DraftNumberInput aria-label="Gap between pocket openings in millimetres" className="h-8" min={0} max={100} step={0.5} value={gap} onValueChange={setGap} />
        <span>mm</span>
      </div>
      <Button size="sm" variant="outline" disabled={!neighbor} onClick={spaceFromNeighbor}>Apply gap</Button>
      <p className="text-muted-foreground">Gap between opening bounds, including top rounding.</p>
    </details>}
    <div className="space-y-1.5">
      <p className="text-xs font-medium">Pocket size before rotation (mm)</p>
      <div className="flex gap-2">{(["x", "y"] as const).map((axis) => {
        const extent = axis === "x" ? shape.bboxMm.maxX - shape.bboxMm.minX : shape.bboxMm.maxY - shape.bboxMm.minY;
        const scale = axis === "x" ? cutout.scaleX : cutout.scaleY;
        return <Label key={axis} className="flex flex-1 items-center gap-1 text-xs">{axis === "x" ? "W" : "L"}<DraftNumberInput className="h-8 min-w-0" aria-label={`Pocket ${axis === "x" ? "width" : "length"} in millimetres`} value={extent * scale + 2 * cutout.clearanceMm} displayPrecision={2} min={extent * 0.05 + 2 * cutout.clearanceMm} max={extent * 20 + 2 * cutout.clearanceMm} step={0.1} onValueChange={(value) => setScale(axis, (value - 2 * cutout.clearanceMm) / extent * 100)} /></Label>;
      })}</div>
      <p className="text-[11px] text-muted-foreground">Includes extra clearance. Top rounding widens the opening further.</p>
      <p className="text-[11px] text-muted-foreground" data-testid="pocket-margin-summary">{shape.traceMarginMm === undefined
        ? `Original trace margin unknown (older project). Extra allowance: ${cutout.clearanceMm.toFixed(2)} mm per edge.`
        : `Trace margin: ${shape.traceMarginMm.toFixed(2)} mm per edge before scaling. Nominal total allowance X/Y: ${(shape.traceMarginMm * cutout.scaleX + cutout.clearanceMm).toFixed(2)} / ${(shape.traceMarginMm * cutout.scaleY + cutout.clearanceMm).toFixed(2)} mm per edge.`}</p>
    </div>
    <div className="rounded border bg-muted/30 p-2 text-xs" data-testid="pocket-depth-summary">
      <p>Cut depth: {pocket.depthMm === null ? "through" : `${pocket.depthMm.toFixed(1)} mm`} · Floor: {(pocket.floorZ ?? 0).toFixed(1)} mm</p>
      <p className="text-muted-foreground">Infill top: {pocket.infillTopZ.toFixed(1)} mm · Total bin: {total.toFixed(1)} mm</p>
      <svg viewBox="0 0 240 65" className="mt-2 h-16 w-full" role="img" aria-label="Cross-section: pocket depth above remaining floor, with stacking rim above infill">
        <path d="M20 5 H40 V15 H200 V5 H220 V60 H20 Z" fill="currentColor" opacity="0.2" />
        <rect x="70" y="15" width="100" height={45 * Math.min(1, Math.max(0, (pocket.depthMm ?? pocket.infillTopZ) / pocket.infillTopZ))} fill="hsl(var(--background))" stroke="currentColor" />
        <text x="120" y="28" textAnchor="middle" fontSize="9" fill="currentColor">Pocket</text>
        <text x="230" y="57" textAnchor="end" fontSize="9" fill="currentColor">Floor</text>
      </svg>
      <Button className="mt-1 w-full" size="sm" variant="outline" onClick={() => { dispatch({ type: "SET_VIEW_MODE", viewMode: "3d" }); inspect({ axis: "x", offsetMm: (bounds.minX + bounds.maxX) / 2 }); }}>Inspect this pocket in 3D</Button>
    </div>
  </div>;
}
