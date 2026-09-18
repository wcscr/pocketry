import { Minus, Spline } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Labeled touch controls shared by the photo and bin contour editors. */
export function ContourEditTools({
  removeActive,
  onChange,
}: {
  removeActive: boolean;
  onChange: (remove: boolean) => void;
}) {
  return (
    <div role="group" aria-label="Contour editing tools" className="flex gap-1 rounded-md border bg-background/95 p-1 shadow-sm backdrop-blur">
      <Button type="button" size="sm" variant={removeActive ? "ghost" : "secondary"}
        className="h-11 gap-2 px-3" aria-pressed={!removeActive} onClick={() => onChange(false)}>
        <Spline className="h-4 w-4" aria-hidden="true" />
        Add / move
      </Button>
      <Button type="button" size="sm" variant={removeActive ? "secondary" : "ghost"}
        className="h-11 gap-2 px-3" aria-pressed={removeActive} onClick={() => onChange(true)}>
        <Minus className="h-4 w-4" aria-hidden="true" />
        Remove vertices
      </Button>
    </div>
  );
}
