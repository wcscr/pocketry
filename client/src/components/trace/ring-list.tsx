import { Circle, Square, Trash2 } from "lucide-react";

import { ringArea } from "@shared/geometry/rings";
import { OUTER_RING, type RingRef } from "@shared/geometry/types";

import { Button } from "@/components/ui/button";
import { iterateRings, removeRing, sameRingRef } from "@/lib/geometry/outline";
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
  const { outline, selection, calibration, imageSize, dispatch } = useTrace();

  if (outline.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No contours yet. Set a detection region to trace the tool.
      </p>
    );
  }

  const mmPerPx =
    calibration && imageSize.height > 0
      ? calibration.lengthMm /
        Math.hypot(
          calibration.endX - calibration.startX,
          calibration.endY - calibration.startY,
        )
      : null;

  const describeArea = (areaPx: number): string => {
    if (mmPerPx === null) return `${Math.round(areaPx)} px²`;
    const mm2 = areaPx * mmPerPx * mmPerPx;
    return mm2 >= 100 ? `${(mm2 / 100).toFixed(1)} cm²` : `${mm2.toFixed(1)} mm²`;
  };

  const select = (ref: RingRef) => {
    dispatch({
      type: "SELECT_RING",
      selection: sameRingRef(selection, ref) ? null : ref,
    });
  };

  const remove = (ref: RingRef) => {
    dispatch({
      type: "OUTLINE_COMMITTED",
      outline: removeRing(outline, ref),
      label: ref.ringIndex === OUTER_RING ? "Remove tool shape" : "Remove interior hole",
    });
    dispatch({ type: "SELECT_RING", selection: null });
  };

  const rings = [...iterateRings(outline)];
  // A shell may only be deleted while another shape survives; deleting the
  // last one would leave the holes with nothing to belong to.
  const shellCount = outline.length;

  return (
    <ul className="space-y-0.5">
      {rings.map(({ ref, ring }) => {
        const isOuter = ref.ringIndex === OUTER_RING;
        const isSelected = sameRingRef(selection, ref);
        const canDelete = isOuter ? shellCount > 1 : true;

        return (
          <li key={`${ref.shapeIndex}:${ref.ringIndex}`}>
            <div
              className={cn(
                "group flex items-center gap-2 rounded px-2 py-1 text-xs",
                isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
              )}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => select(ref)}
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
                    : `Hole ${ref.ringIndex + 1}`}
                </span>
                <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                  {ring.length} pts · {describeArea(ringArea(ring))}
                </span>
              </button>

              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                disabled={!canDelete}
                onClick={() => remove(ref)}
                aria-label={
                  isOuter
                    ? `Delete shape ${ref.shapeIndex + 1}`
                    : `Delete hole ${ref.ringIndex + 1}`
                }
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
