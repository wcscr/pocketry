import { Circle, RectangleHorizontal } from "lucide-react";
import { Item as RadioGroupItem } from "@radix-ui/react-radio-group";
import { fingerAccessOptions, type FingerAccessOptions, type FingerHole } from "@shared/gridfinity/cutout";
import { RadioGroup } from "@/components/ui/radio-group";

const segmentClass = "flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-sm px-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:bg-background data-[state=checked]:text-foreground data-[state=checked]:shadow-sm";

/** Schematic plan and transverse section, independent of edge-round settings. */
function ShapePreview({ shape, bottom, ends }: FingerAccessOptions): JSX.Element {
  return (
    <svg viewBox="0 0 216 64" className="h-16 w-full text-cyan-700 dark:text-cyan-300" role="img"
      aria-label={`${shape === "round" ? "Round" : `Slot with ${ends} ends`}, ${bottom} bottom: top and cross-section views`}>
      <g fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="1.5">
        {shape === "slot"
          ? <rect x="18" y="13" width="68" height="26" rx={ends === "rounded" ? 13 : 0} />
          : <circle cx="52" cy="26" r="18" />}
        <path d={bottom === "flat"
          ? "M128 8 H136 V43 H184 V8 H192"
          : "M128 8 H136 V19 A24 24 0 0 0 184 19 V8 H192"} fill="none" />
      </g>
      <path d="M136 8 H184" stroke="currentColor" strokeOpacity="0.4" strokeDasharray="2 2" />
      <g fill="currentColor" fontSize="10" textAnchor="middle">
        <text x="52" y="60">Top</text>
        <text x="160" y="60">Cross-section</text>
      </g>
    </svg>
  );
}

export function FingerAccessShapeControls({ hole, onChange }: {
  hole: FingerHole;
  onChange: (change: Partial<FingerAccessOptions>) => void;
}): JSX.Element {
  const options = fingerAccessOptions(hole);
  return (
    <div className="space-y-2" data-testid="finger-access-shape-controls">
      <div className="flex items-center gap-2">
        <span id="finger-access-shape-label" className="w-12 shrink-0 text-xs">Shape</span>
        <RadioGroup value={options.shape} orientation="horizontal" aria-labelledby="finger-access-shape-label"
          className="flex min-w-0 flex-1 gap-0 rounded-md border bg-muted p-0.5"
          onValueChange={(shape: FingerAccessOptions["shape"]) => onChange({ shape })}>
          <RadioGroupItem value="round" className={segmentClass} data-testid="finger-shape-round"><Circle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Round</RadioGroupItem>
          <RadioGroupItem value="slot" className={segmentClass} data-testid="finger-shape-slot"><RectangleHorizontal className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Slot</RadioGroupItem>
        </RadioGroup>
      </div>
      <div className="flex items-center gap-2">
        <span id="finger-access-bottom-label" className="w-12 shrink-0 text-xs">Bottom</span>
        <RadioGroup value={options.bottom} orientation="horizontal" aria-labelledby="finger-access-bottom-label"
          className="flex min-w-0 flex-1 gap-0 rounded-md border bg-muted p-0.5"
          onValueChange={(bottom: FingerAccessOptions["bottom"]) => onChange({ bottom })}>
          <RadioGroupItem value="curved" className={segmentClass} data-testid="finger-bottom-curved">Curved</RadioGroupItem>
          <RadioGroupItem value="flat" className={segmentClass} data-testid="finger-bottom-flat">Flat</RadioGroupItem>
        </RadioGroup>
      </div>
      {options.shape === "slot" && (
        <div className="flex items-center gap-2">
          <span id="finger-access-ends-label" className="w-12 shrink-0 text-xs">Ends</span>
          <RadioGroup value={options.ends} orientation="horizontal" aria-labelledby="finger-access-ends-label"
            className="flex min-w-0 flex-1 gap-0 rounded-md border bg-muted p-0.5"
            onValueChange={(ends: FingerAccessOptions["ends"]) => onChange({ ends })}>
            <RadioGroupItem value="rounded" className={segmentClass} data-testid="finger-ends-rounded">Rounded</RadioGroupItem>
            <RadioGroupItem value="flat" className={segmentClass} data-testid="finger-ends-flat">Flat</RadioGroupItem>
          </RadioGroup>
        </div>
      )}
      <ShapePreview {...options} />
    </div>
  );
}
