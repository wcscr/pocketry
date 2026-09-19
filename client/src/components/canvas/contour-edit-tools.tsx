import { Minus } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Labeled touch controls shared by the photo and bin contour editors. */
export function ContourEditTools({
  removeActive,
  onChange,
  selectionLabel = "Contour",
  compact = false,
}: {
  removeActive: boolean;
  onChange: (remove: boolean) => void;
  selectionLabel?: string;
  compact?: boolean;
}) {
  return (
    <div role="group" aria-label="Contour editing tools" className={compact
      ? "flex items-center gap-1"
      : "flex items-center gap-2 rounded-md border bg-background/95 p-1 pl-3 shadow-sm backdrop-blur"}>
      <span className="text-xs font-medium whitespace-nowrap">{selectionLabel}</span>
      <Button type="button" size="sm" variant={removeActive ? "destructive" : "outline"}
        className={compact ? "h-9 gap-1 px-1.5 text-xs" : "h-11 gap-2 px-3"} aria-label="Remove vertices" aria-pressed={removeActive} onClick={() => onChange(!removeActive)}>
        <Minus className="h-4 w-4" aria-hidden="true" />
        Remove
      </Button>
    </div>
  );
}
