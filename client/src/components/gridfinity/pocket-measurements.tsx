import { expandLinkedObjectEdits } from "@/lib/gridfinity/object-arrangement";
import { hasRigidPocket, rigidPocket, resetPocketPlane } from "@shared/gridfinity/rigid-pocket";
import { hasPocketTilt, pocketAxis } from "@shared/gridfinity/pocket-orientation";
import { profileAlongX, profilePrisms, hasProfileRotation } from "@shared/gridfinity/profile-bottom";
import { outlineBounds } from "@/lib/geometry/outline";
import { useState, type ReactNode } from "react";
import { ChevronDown, Lock, Unlock } from "lucide-react";
import { pocketName, placementFootprint, resolvePlacedPocketDepth, pocketOccupiedOutline, pocketLayoutAllowanceMm, type CutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { binTotalHeightMm } from "@shared/gridfinity/standard";
import { Button } from "@/components/ui/button";
import { DraftNumberInput } from "@/components/ui/draft-number-input";
import { HelpHint } from "@/components/ui/help-hint";
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
    <div className="flex items-center gap-1"><p className="text-xs font-medium">Position from bin center (mm)</p><HelpHint label="pocket position">Positive X is right; positive Y is up.</HelpHint></div>
    <div className="grid grid-cols-2 gap-2">{(["x", "y"] as const).map((axis) => <Label key={axis} className="flex min-w-0 items-center gap-2 text-xs">
      {axis.toUpperCase()}
      <DraftNumberInput aria-label={`${axis.toUpperCase()} position in millimetres`} className="h-8 min-w-0" value={position[axis]} displayPrecision={2} step={0.5}
        onValueChange={(value) => onChange({ ...position, [axis]: value }, true)}
        onValueCommit={(value) => onChange({ ...position, [axis]: value }, false)} />
    </Label>)}</div>
  </div>;
}

export function PocketMeasurements({ cutout, shape, children }: {
  cutout: CutoutPlacement; shape: TracedShape;
  children?: ReactNode;
}): JSX.Element {
  const { spec, cutouts, dispatch } = useBin();
  const { shapes } = useShapeLibrary();
  const [neighborId, setNeighborId] = useState("");
  const [side, setSide] = useState<"right" | "left" | "above" | "below">("right");
  const [gap, setGap] = useState(3);
  const updatePosition = (position: CutoutPlacement["position"], transient = false) => dispatch({ type: "UPDATE_CUTOUT", id: cutout.id, patch: { position }, transient, historyLabel: "Position tool pocket" });
  const updateRigid = (patch: CutoutPlacement, transient: boolean, historyLabel: string) => {
    const objects = cutouts.flatMap(c => {
      const source = shapes.find(s => s.id === c.shapeId) ?? (c.shapeId === shape.id ? shape : undefined);
      return source ? [{ kind: "pocket" as const, cutout: c, shape: source }] : [];
    });
    const edits = expandLinkedObjectEdits(objects, spec, { cutouts: [patch], fingerHoles: [] });
    if (edits) dispatch({ type: "UPDATE_OBJECTS", edits, transient, historyLabel });
  };
  const updateTilt = (axis: "xDeg" | "yDeg", value: number, transient: boolean) => updateRigid({
    ...rigidPocket(cutout, shape, spec), tilt: { xDeg: cutout.tilt?.xDeg ?? 0, yDeg: cutout.tilt?.yDeg ?? 0, [axis]: value },
  }, transient, "Rotate tool pocket");
  const bounds = outlineBounds(pocketOccupiedOutline(shape, cutout, spec))!;
  const neighbor = cutouts.find((item) => item.id === neighborId && item.id !== cutout.id);
  const neighborShape = shapes.find((item) => item.id === neighbor?.shapeId);
  const spaceFromNeighbor = () => {
    if (!neighbor || !neighborShape) return;
    const target = outlineBounds(pocketOccupiedOutline(neighborShape, neighbor, spec))!;
    // Tilted shafts use conservative bounds, including clearance and rounding.
    const allowance = pocketLayoutAllowanceMm(cutout) + pocketLayoutAllowanceMm(neighbor) + gap;
    const dx = side === "right" ? target.maxX + allowance - bounds.minX : side === "left" ? target.minX - allowance - bounds.maxX : 0;
    const dy = side === "above" ? target.maxY + allowance - bounds.minY : side === "below" ? target.minY - allowance - bounds.maxY : 0;
    updatePosition({ x: cutout.position.x + dx, y: cutout.position.y + dy });
  };
  return <div className="space-y-2">
    <details className="group/precision border-t pt-1 text-xs" data-testid="pocket-position-settings">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded py-1.5 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        Position &amp; rotation
        <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open/precision:rotate-180" />
      </summary>
      <div className="space-y-3 pb-2 pt-2">
        {children}
        <div className="space-y-2" data-testid="pocket-rotation-controls">
          <div className="flex items-center gap-1"><p className="font-medium">Rotate pocket</p><HelpHint label="pocket rotation">Rotate the generated pocket around any axis. Depth is its thickness along the original outline’s normal. Elevation keeps its lowest point at the chosen height. The opening is where the solid intersects the fill surface.</HelpHint></div>
          <div className="grid grid-cols-2 gap-2">{(["xDeg", "yDeg"] as const).map(axis => <Label key={axis} className="flex min-w-0 items-center gap-2 text-xs">
            {axis === "xDeg" ? "X" : "Y"}
            <DraftNumberInput className="h-8 min-w-0" aria-label={`Pocket ${axis === "xDeg" ? "X" : "Y"} rotation in degrees`}
              value={cutout.tilt?.[axis] ?? 0} step={5} displayPrecision={1}
              normalize={value => ((value + 180) % 360 + 360) % 360 - 180}
              onValueChange={value => updateTilt(axis, value, true)}
              onValueCommit={value => updateTilt(axis, value, false)} />
            <span>°</span>
          </Label>)}</div>
          <Button size="sm" variant="outline" disabled={!hasPocketTilt(cutout)}
            onClick={() => updateRigid(resetPocketPlane(cutout, shape, spec), false, "Reset pocket to X–Y plane")}>
            Reset to X–Y plane
          </Button>
          <Label className="flex items-center gap-2 text-xs">Elevation
            <DraftNumberInput className="h-8 min-w-0" aria-label="Pocket elevation in millimetres" min={0} max={300} step={0.5} displayPrecision={2}
              value={rigidPocket(cutout, shape, spec).elevationMm ?? 0}
              onValueChange={elevationMm => updateRigid({ ...rigidPocket(cutout, shape, spec), elevationMm }, true, "Raise or lower pocket")}
              onValueCommit={elevationMm => updateRigid({ ...rigidPocket(cutout, shape, spec), elevationMm }, false, "Raise or lower pocket")} />
            <span>mm</span>
          </Label>
          <p className="text-muted-foreground">Elevation is the lowest point above the bin underside. Raising or lowering keeps the pocket’s dimensions.</p>
        </div>
        <PositionInputs position={cutout.position} onChange={updatePosition} />

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => updatePosition({ ...cutout.position, x: cutout.position.x - (bounds.minX + bounds.maxX) / 2 })}>Center X</Button>
          <Button variant="outline" size="sm" onClick={() => updatePosition({ ...cutout.position, y: cutout.position.y - (bounds.minY + bounds.maxY) / 2 })}>Center Y</Button>
        </div>
        {cutouts.length > 1 && <details className="group/spacing space-y-2 border-t text-xs">
          <summary className="cursor-pointer"><span className="flex items-center gap-1">Space beside another pocket <HelpHint label="pocket spacing">Gap between pocket bounds, including clearance and top rounding. Tilted pockets also reserve space for the shaft below the opening.</HelpHint></span><ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open/spacing:rotate-180" /></summary>
          <select className="h-8 w-full rounded border bg-background px-2" aria-label="Reference pocket" value={neighborId} onChange={(event) => setNeighborId(event.target.value)}>
            <option value="">Choose a pocket</option>
            {cutouts.filter((item) => item.id !== cutout.id).map((item) => <option key={item.id} value={item.id}>{pocketName(item, shapes.find((shape) => shape.id === item.shapeId))}</option>)}
          </select>
          <div className="flex gap-2">
            <select aria-label="Side of reference pocket" className="rounded border bg-background" value={side} onChange={(event) => setSide(event.target.value as typeof side)}>
              <option value="right">Right</option><option value="left">Left</option><option value="above">Above</option><option value="below">Below</option>
            </select>
            <DraftNumberInput aria-label="Gap between pocket openings in millimetres" className="h-8" min={0} max={100} step={0.5} value={gap} onValueChange={setGap} />
            <span>mm</span>
          </div>
          <Button size="sm" variant="outline" disabled={!neighbor} onClick={spaceFromNeighbor}>Apply gap</Button>
        </details>}

      </div>
    </details>
  </div>;
}

/** Depth controls, feedback, and inspection share one section, expanded for each newly selected pocket. */
export function PocketDepthSummary({ cutout, shape, section, inspect, children }: {
  cutout: CutoutPlacement; shape: TracedShape;
  section: BuildBinSection | null;
  inspect: (section: BuildBinSection | null) => void;
  children?: ReactNode;
}): JSX.Element {
  const { spec, dispatch } = useBin();
  const [inspectionAxis, setInspectionAxis] = useState<BuildBinSection["axis"]>("x");
  const pocket = resolvePlacedPocketDepth(spec, cutout.depth, shape, cutout);
  const rigid = hasRigidPocket(cutout);
  const displayedDepth = rigid ? pocket.axialDepthMm : pocket.depthMm;
  const total = binTotalHeightMm(spec.heightUnits, spec.lip === "standard");
  const bounds = outlineBounds(placementFootprint(shape, cutout).outline)!;
  const inspectionSection = (axis: BuildBinSection["axis"]): BuildBinSection => ({
    axis, offsetMm: axis === "x" ? (bounds.minX + bounds.maxX) / 2 : (bounds.minY + bounds.maxY) / 2,
  });
  return <div className="space-y-2">
    <details key={cutout.id} open className="group/depth text-xs" data-testid="pocket-depth-summary">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded py-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span>{cutout.profileBottom ? "Bottom profile" : "Depth"}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open/depth:rotate-180" />
      </summary>
      {children}
      <div className="rounded border bg-muted/30 p-2">
        <p className="text-muted-foreground">{rigid ? "Depth" : cutout.profileBottom ? "Deepest cut" : hasPocketTilt(cutout) ? "Vertical depth" : "Cut depth"}: {displayedDepth === null ? "through" : `${displayedDepth.toFixed(1)} mm`} · {cutout.profileBottom || rigid ? "Lowest point" : "Floor"}: {(pocket.floorZ ?? 0).toFixed(1)} mm</p>
        <p className="text-muted-foreground">Infill top: {pocket.infillTopZ.toFixed(1)} mm · Total bin: {total.toFixed(1)} mm</p>
        {hasPocketTilt(cutout) && <p className="mt-1 text-muted-foreground">Along pocket axis: {pocket.axialDepthMm === null ? "through" : `${pocket.axialDepthMm.toFixed(1)} mm`} · Axis tilt: {(Math.acos(pocketAxis(cutout).z) * 180 / Math.PI).toFixed(1)}°</p>}
        {cutout.profileBottom && !hasProfileRotation(cutout) && <ProfileSectionPreview cutout={cutout} shape={shape} top={pocket.infillTopZ} />}
        {hasProfileRotation(cutout) && <p className="mt-1 text-muted-foreground">Rotated profile · Inspect in 3D to see the supporting contour.</p>}
        {!cutout.profileBottom && !hasRigidPocket(cutout) && !hasPocketTilt(cutout) && <svg viewBox="0 0 240 65" className="mt-2 h-16 w-full" role="img" aria-label="Cross-section: pocket depth above remaining floor, with stacking rim above infill">
          <path d="M20 5 H40 V15 H200 V5 H220 V60 H20 Z" fill="currentColor" opacity="0.2" />
          <rect x="70" y="15" width="100" height={45 * Math.min(1, Math.max(0, (pocket.depthMm ?? pocket.infillTopZ) / pocket.infillTopZ))} fill="hsl(var(--background))" stroke="currentColor" />
          <text x="120" y="28" textAnchor="middle" fontSize="9" fill="currentColor">Pocket</text>
          <text x="230" y="57" textAnchor="end" fontSize="9" fill="currentColor">Floor</text>
        </svg>}
      </div>
      <Button className="mt-2 h-8 w-full text-xs" size="sm" variant="outline" data-testid="button-inspect-pocket" onClick={() => {
        dispatch({ type: "SET_VIEW_MODE", viewMode: "3d" });
        inspect(section ? null : inspectionSection(inspectionAxis));
      }}>{section ? "Show full bin" : "Inspect this pocket in 3D"}</Button>
      {section && <div className="mt-2 flex items-center gap-2" role="group" aria-label="Pocket inspection axis">
        <span className="text-muted-foreground">Cut axis</span>
        {(["x", "y"] as const).map(axis => <Button key={axis} size="sm" variant={section.axis === axis ? "secondary" : "outline"}
          aria-label={`Inspect pocket along ${axis.toUpperCase()}`} aria-pressed={section.axis === axis}
          onClick={() => { setInspectionAxis(axis); inspect(inspectionSection(axis)); }}>
          {axis.toUpperCase()}
        </Button>)}
      </div>}
    </details>
  </div>;
}

/** Side view uses the same finite source cells as the cutter. */
function ProfileSectionPreview({ cutout, shape, top }: { cutout: CutoutPlacement; shape: TracedShape; top: number }): JSX.Element {
  const alongX = profileAlongX(cutout.profileBottom!);
  const rings = profilePrisms(shape.outlineMm, { ...cutout, position: { x: 0, y: 0 }, rotationDeg: 0 })
    .map(cell => cell.vertices.slice(0, cell.capSize).map(p => ({ x: alongX ? p.x : p.y, y: p.z })));
  const points = rings.flat();
  const min = Math.min(0, ...points.map(p => p.x)), max = Math.max(0, ...points.map(p => p.x));
  const height = Math.max(top, ...points.map(p => p.y), 1);
  const x = (u: number) => 20 + (u - min) / Math.max(0.1, max - min) * 200;
  const y = (z: number) => 65 - z / height * 55;
  return <svg viewBox="0 0 240 80" className="mt-2 h-20 w-full" role="img" aria-label="Side view: the profile intersects the dashed fill surface">
    <rect x="15" y={y(top)} width="210" height={65 - y(top)} fill="currentColor" opacity="0.2" />
    {rings.map((ring, i) => <path key={i} d={`M${ring.map(p => `${x(p.x)},${y(p.y)}`).join("L")}Z`} fill="hsl(var(--background))" />)}
    <path d={`M15,${y(top)}H225`} stroke="currentColor" strokeDasharray="3 3" opacity="0.4" />
    <text x="120" y="78" textAnchor="middle" fontSize="10" fill="currentColor">Bottom contour · side view</text>
  </svg>;
}

/** Everyday dimensions are visible independently of precision placement controls. */
export function PocketSizeInputs({ cutout, shape, setScale }: {
  cutout: CutoutPlacement;
  shape: TracedShape;
  setScale: (axis: "x" | "y", percent: number) => void;
}): JSX.Element {
  const { dispatch } = useBin();
  const clearance = cutout.profileBottom ? 0 : cutout.clearanceMm;
  const dimension = (axis: "x" | "y") => cutout.profileBottom
    ? ((axis === "x") === profileAlongX(cutout.profileBottom) ? "Profile length" : "Profile height")
    : `Pocket ${axis === "x" ? "width" : "length"}`;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1"><p className="text-xs font-medium">{cutout.profileBottom ? "Source profile dimensions" : "Dimensions"}</p><HelpHint label="pocket size">{cutout.profileBottom ? "Length and height of the upright source outline. Slot width is independent. Scaling keeps the lowest point at the selected elevation." : "Width and length in mm, before rotation. Includes extra clearance; top edge rounding widens the opening further."}</HelpHint></div>
        <Button
          type="button"
          variant={cutout.aspectRatioLocked ? "secondary" : "outline"}
          size="sm"
          className="h-6 shrink-0 gap-1 px-1.5 text-[11px]"
          aria-label={cutout.aspectRatioLocked ? "Unlock pocket aspect ratio" : "Lock pocket aspect ratio"}
          aria-pressed={cutout.aspectRatioLocked}
          onClick={() => dispatch({
            type: "UPDATE_CUTOUT", id: cutout.id,
            patch: { aspectRatioLocked: !cutout.aspectRatioLocked },
            historyLabel: cutout.aspectRatioLocked ? "Unlock pocket proportions" : "Lock pocket proportions",
          })}
        >
          {cutout.aspectRatioLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
          Keep proportions
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(["x", "y"] as const).map((axis) => {
          const extent = axis === "x" ? shape.bboxMm.maxX - shape.bboxMm.minX : shape.bboxMm.maxY - shape.bboxMm.minY;
          const scale = axis === "x" ? cutout.scaleX : cutout.scaleY;
          return (
            <Label key={axis} className="flex min-w-0 items-center gap-1 text-xs">
              {cutout.profileBottom ? (dimension(axis) === "Profile length" ? "L" : "H") : axis === "x" ? "W" : "L"}
              <DraftNumberInput
                className="h-8 min-w-0"
                aria-label={`${dimension(axis)} in millimetres`}
                value={Math.max(0, extent * scale + 2 * clearance)}
                displayPrecision={2}
                min={Math.max(0, extent * 0.05 + 2 * clearance)}
                max={Math.max(0, extent * 20 + 2 * clearance)}
                step={0.1}
                onValueChange={(value) => setScale(axis, (value - 2 * clearance) / extent * 100)}
              />
              <span className="text-[11px] text-muted-foreground">mm</span>
            </Label>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-1"><p className="text-xs font-medium">Scale</p><HelpHint label="pocket scale">Drag layout edges or corners. Keep proportions links width and length.</HelpHint></div>
        {(cutout.scaleX !== 1 || cutout.scaleY !== 1) && (
          <Button type="button" variant="ghost" size="sm" className="h-5 px-1.5 text-[11px]" onClick={() => dispatch({ type: "UPDATE_CUTOUT", id: cutout.id, patch: { scaleX: 1, scaleY: 1 }, historyLabel: "Reset tool pocket scale" })}>Reset 100%</Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {(["x", "y"] as const).map((axis) => (
          <Label key={axis} className="flex min-w-0 items-center gap-1 text-xs">
            {cutout.profileBottom ? (dimension(axis) === "Profile length" ? "L" : "H") : axis === "x" ? "W" : "L"}
            <DraftNumberInput
              className="h-8 min-w-0"
              aria-label={`${dimension(axis)} scale percent`}
              data-testid={`input-pocket-scale-${axis}`}
              value={Math.round((axis === "x" ? cutout.scaleX : cutout.scaleY) * 1000) / 10}
              min={5} max={2000} step={1}
              onValueChange={(percent) => setScale(axis, percent)}
            />
            <span className="text-[11px] text-muted-foreground">%</span>
          </Label>
        ))}
      </div>
    </div>
  );
}
