import { useRef } from "react";

import { DraftNumberInput } from "@/components/ui/draft-number-input";
import { HelpHint } from "@/components/ui/help-hint";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

const SNAP_POINTS = [25, 50, 75, 100] as const;

/** Snap a released pointer within three percentage points of a quarter mark. */
export function snapFillHeightPercent(value: number): number {
  return SNAP_POINTS.find((point) => Math.abs(point - value) <= 3) ?? value;
}

/** Continuous percentages with quarter-height snaps; typing and keyboard stay precise. */
export function FillHeightControl({ value, onChange }: {
  value: number;
  onChange: (value: number, transient: boolean) => void;
}): JSX.Element {
  const pointerInteraction = useRef(false);
  return (
    <div className="space-y-2" data-testid="fill-height-control">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Label className="text-xs" htmlFor="fill-height-percent">Fill height</Label>
          <HelpHint label="fill height">
            Percentage of the available height above the base. Walls and stacking lip stay full height.
            {" "}Snaps to 25%, 50%, 75%, and 100%.
          </HelpHint>
        </div>
        <span className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
          <DraftNumberInput
            id="fill-height-percent"
            aria-label="Fill height percentage"
            className="h-8 w-16"
            value={value}
            min={1}
            max={100}
            step={1}
            onValueChange={(next) => onChange(next, true)}
            onValueCommit={(next) => onChange(next, false)}
          /> %
        </span>
      </div>
      <div className="relative py-1">
        <div className="pointer-events-none absolute inset-x-2.5 top-1/2 h-3 -translate-y-1/2" aria-hidden="true">
          {SNAP_POINTS.map((point) => (
            <span
              key={point}
              className="absolute h-full w-px -translate-x-1/2 bg-foreground/50"
              style={{ left: `${(point - 1) / 99 * 100}%` }}
            />
          ))}
        </div>
        <Slider
          aria-label="Fill height"
          value={[value]}
          min={1}
          max={100}
          step={1}
          onPointerDownCapture={() => { pointerInteraction.current = true; }}
          onKeyDownCapture={() => { pointerInteraction.current = false; }}
          onValueChange={([next]) => onChange(next, true)}
          onValueCommit={([next]) => onChange(pointerInteraction.current ? snapFillHeightPercent(next) : next, false)}
        />
      </div>
    </div>
  );
}
