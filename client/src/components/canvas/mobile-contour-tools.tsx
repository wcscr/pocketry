import { Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Actions apply to the selected point; they never change what a canvas drag does. */
export function MobileContourTools({ selected, canRemove, onRemove, onDone }: {
  selected: boolean; canRemove: boolean; onRemove: () => void; onDone: () => void;
}) {
  return <div role="group" aria-label="Contour editing tools" className="flex items-center gap-2 rounded-md border bg-background/95 p-1 pl-3 shadow-sm">
    {selected ? <Button className="h-11 gap-2 px-3 text-xs" variant="outline" disabled={!canRemove}
      onClick={onRemove}><Trash2 className="h-4 w-4" aria-hidden />Delete point</Button> :
      <span className="text-xs text-muted-foreground">Drag points · tap line to add</span>}
    <Button variant="secondary" className="h-11 gap-1 px-3" aria-label="Finish contour editing" onClick={onDone}><Check className="h-4 w-4" />Done</Button>
  </div>;
}
