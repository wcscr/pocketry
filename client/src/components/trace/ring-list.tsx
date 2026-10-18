import { ContourMenuProvider, useContourContextMenu } from "./contour-context-menu";
import { contextMenuPoint, usesNativeEditingMenu } from "@/components/ui/pointer-context-menu";
import { Circle, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ringArea } from "@shared/geometry/rings";
import { mmPerPixel } from "@shared/geometry/scale";
import { OUTER_RING, type RingRef } from "@shared/geometry/types";

import { HelpHint } from "@/components/ui/help-hint";
import { Button } from "@/components/ui/button";
import { iterateRings, sameRingRef } from "@/lib/geometry/outline";
import { removeTraceRing, traceRingKey } from "@/lib/geometry/ring-key";
import { changeContourRole } from "@/lib/geometry/contour-role";
import { withKernel } from "@/lib/manifold/runtime";
import { cn } from "@/lib/utils";
import { useTrace } from "@/state/trace-store";

/**
 * Lists every ring the detector found, so a spurious contour can be removed.
 *
 * The outline is no longer a single closed path — it is shells plus their holes
 * plus any disjoint parts — and there is no discoverable way to select an
 * individual ring by clicking a shared canvas. A list is that affordance, and
 * it doubles as the readout that tells the user a hole was actually found.
 */
export function RingList(): JSX.Element {
  const menu = useContourContextMenu();
  return menu ? <RingListContent /> : <ContourMenuProvider><RingListContent /></ContourMenuProvider>;
}

function RingListContent(): JSX.Element {
  const openMenu = useContourContextMenu();
  const { outline, selection, calibration, region, processing, sourceRevision, dispatch } = useTrace();
  const [changingRole, setChangingRole] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const latest = useRef({ outline, sourceRevision });
  latest.current = { outline, sourceRevision };
  const mounted = useRef(true);
  const pendingSource = useRef<number | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pendingSource.current === latest.current.sourceRevision) dispatch({ type: "SET_PROCESSING", processing: false });
    };
  }, [dispatch]);
  useEffect(() => setRoleError(null), [outline]);

  const changeRole = async (ref: RingRef, role: "pocket" | "hole") => {
    if (processing || pendingSource.current !== null) return;
    pendingSource.current = sourceRevision;
    dispatch({ type: "SET_PROCESSING", processing: true });
    setChangingRole(true);
    setRoleError(null);
    try {
      const changed = await withKernel(kernel => changeContourRole(kernel, outline, ref, role));
      // A photo edit, redetection or undo while WASM loads supersedes this edit.
      if (!mounted.current || latest.current.outline !== outline || latest.current.sourceRevision !== sourceRevision) return;
      dispatch({ type: "OUTLINE_COMMITTED", outline: changed,
        label: role === "hole" ? "Make hole (keep material)" : "Make pocket (cut material)" });
      dispatch({ type: "SELECT_RING", selection: null });
    } catch (cause) {
      if (mounted.current && latest.current.outline === outline) setRoleError(cause instanceof Error ? cause.message : "Could not change contour type.");
    } finally {
      pendingSource.current = null;
      if (mounted.current) {
        setChangingRole(false);
        if (latest.current.sourceRevision === sourceRevision) dispatch({ type: "SET_PROCESSING", processing: false });
      }
    }
  };

  if (outline.length === 0) {
    return (
      <p role="status" className="text-xs text-muted-foreground">
        {processing ? "Looking for the tool’s outline…"
          : region ? "No outline found. Increase Sensitivity or redraw the region around the whole tool."
          : "No outline yet. Set a detection region around the tool."}
      </p>
    );
  }

  const mmPerPx = mmPerPixel(calibration);

  const describeArea = (areaPx: number): string => {
    if (mmPerPx === null) return `${Math.round(areaPx)} px²`;
    const mm2 = areaPx * mmPerPx * mmPerPx;
    return mm2 >= 100 ? `${(mm2 / 100).toFixed(1)} cm²` : `${mm2.toFixed(1)} mm²`;
  };

  const select = (ref: RingRef, references: RingRef[]) => {
    dispatch({
      type: "SELECT_RING",
      selection: references.some(reference => sameRingRef(selection, reference)) ? null : ref,
    });
  };

  const remove = (ref: RingRef) => {
    dispatch({
      type: "OUTLINE_COMMITTED",
      outline: removeTraceRing(outline, ref),
      label: ref.ringIndex === OUTER_RING ? "Remove tool shape" : "Remove interior hole",
    });
    dispatch({ type: "SELECT_RING", selection: null });
  };

  // A shared exclusion has several storage references but is one user object.
  const rings: { ref: RingRef; ring: (typeof outline)[number]["outer"]; references: RingRef[]; holeNumber?: number }[] = [];
  const holes = new Map<string, typeof rings[number]>();
  for (const { ref, ring } of iterateRings(outline)) {
    if (ref.ringIndex === OUTER_RING) rings.push({ ref, ring, references: [ref] });
    else {
      const key = traceRingKey(ring);
      const existing = holes.get(key);
      if (existing) existing.references.push(ref);
      else {
        const entry = { ref, ring, references: [ref], holeNumber: holes.size + 1 };
        holes.set(key, entry);
        rings.push(entry);
      }
    }
  }
  // A shell may only be deleted while another shape survives; deleting the
  // last one would leave the holes with nothing to belong to.
  const shellCount = outline.length;
  const tinyShapes = mmPerPx === null ? [] : outline.filter((shape) => ringArea(shape.outer) * mmPerPx ** 2 < 2);

  return (
    <div className="space-y-2">
    <ul className="space-y-0.5">
      {rings.map(({ ref, ring, references, holeNumber }) => {
        const isOuter = ref.ringIndex === OUTER_RING;
        const isSelected = references.some(reference => sameRingRef(selection, reference));
        const canDelete = isOuter ? shellCount > 1 : true;

        return (
          <li key={`${ref.shapeIndex}:${ref.ringIndex}`} onContextMenu={event => { if (!usesNativeEditingMenu(event.target) && openMenu?.(ref, contextMenuPoint(event))) event.preventDefault(); }}>
            <div
              className={cn(
                "flex items-center gap-2 rounded px-2 py-1 text-xs",
                isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
              )}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => select(ref, references)}
                aria-pressed={isSelected}
              >
                {isOuter ? (
                  <Square className="h-3 w-3 shrink-0" aria-hidden />
                ) : (
                  <Circle className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
                )}
                <span className="truncate">
                  {isOuter
                    ? `Shape ${ref.shapeIndex + 1}`
                    : `Hole ${holeNumber}`}
                </span>
                {references.length > 1 && <span className="shrink-0 text-muted-foreground" title={`Shared by ${references.length} pockets`}>Shared</span>}
                <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                  {ring.length} pts · {describeArea(ringArea(ring))}
                </span>
              </button>

              <select
                aria-label={`${isOuter ? `Shape ${ref.shapeIndex + 1}` : `Hole ${holeNumber} of shape ${ref.shapeIndex + 1}`} type`}
                className="h-7 max-w-24 rounded border border-input bg-background px-1 text-xs"
                value={isOuter ? "pocket" : "hole"}
                disabled={processing || changingRole}
                onChange={event => void changeRole(ref, event.target.value as "pocket" | "hole")}
              >
                <option value="pocket">Pocket</option>
                <option value="hole" disabled={isOuter && shellCount < 2}>Hole</option>
              </select>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0"
                disabled={!canDelete}
                onClick={() => remove(ref)}
                aria-label={
                  isOuter
                    ? `Delete shape ${ref.shapeIndex + 1}`
                    : `Delete hole ${holeNumber}`
                }
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
      <p className="text-xs text-muted-foreground">Pocket cuts material. Hole keeps material inside a pocket; crossing its edge makes a notch.</p>
      {roleError && <p role="alert" className="text-xs text-destructive">{roleError}</p>}
      <div className="flex items-center gap-1">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-1">
          <Button size="sm" variant="outline" className="h-auto min-h-9 min-w-0 whitespace-normal px-2 py-1.5 leading-tight" aria-label="Remove all holes" disabled={!outline.some((shape) => shape.holes.length)}
            onClick={() => { dispatch({ type: "OUTLINE_COMMITTED", outline: outline.map((shape) => ({ ...shape, holes: [] })), label: "Remove all interior holes" }); dispatch({ type: "SELECT_RING", selection: null }); }}>
            Remove holes
          </Button>
          <Button size="sm" variant="outline" className="h-auto min-h-9 min-w-0 whitespace-normal px-2 py-1.5 leading-tight" disabled={!tinyShapes.length || tinyShapes.length === outline.length}
            onClick={() => { dispatch({ type: "OUTLINE_COMMITTED", outline: outline.filter((shape) => !tinyShapes.includes(shape)), label: "Remove tiny shapes" }); dispatch({ type: "SELECT_RING", selection: null }); }}>
            Remove specks ({tinyShapes.length})
          </Button>
        </div>
        <HelpHint label="contour cleanup">Remove all holes fills interior openings. Specks are separate shapes smaller than 2 mm². Removal can be undone.</HelpHint>
      </div>
    </div>
  );
}
