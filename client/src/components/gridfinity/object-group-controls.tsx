import { Group, Ungroup } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HelpHint } from "@/components/ui/help-hint";
import { useBin } from "@/state/bin-store";
import { useShapeLibrary } from "@/state/shape-library";
import { useMobileObjectTools } from "./mobile-object-tools-context";
import { createPlacementGroup, objectGroup, selectedPlacementGroup, type EditableObject } from "@/lib/gridfinity/object-arrangement";

/** Grouping describes placement separately from shared geometry. */
export function ObjectGroupControls(): JSX.Element | null {
  const bin = useBin();
  const compact = !!useMobileObjectTools();
  const { shapes } = useShapeLibrary();
  const selected: EditableObject[] = bin.selection.flatMap<EditableObject>(ref => {
    if (ref.kind === "finger") {
      const hole = bin.fingerHoles.find(h => h.id === ref.id);
      return hole ? [{ kind: "finger", hole }] : [];
    }
    const cutout = bin.cutouts.find(c => c.id === ref.id), shape = shapes.find(s => s.id === cutout?.shapeId);
    return cutout && shape ? [{ kind: "pocket", cutout, shape }] : [];
  });
  const group = selectedPlacementGroup(selected);
  if (selected.length < 2 && !group) return null;
  const ungroup = <Button size="sm" variant="outline" onClick={() => bin.dispatch({ type: "UNGROUP_SELECTION" })}><Ungroup className="mr-1 h-3.5 w-3.5" />Ungroup</Button>;
  return <section aria-label="Object grouping" className="space-y-2 border-b px-3 py-2 text-xs">
    <div className="flex items-center gap-2"><Group className="h-4 w-4" />
      <span className="flex-1 font-medium">{group ? `Group · ${selected.length} objects` : `${selected.length} selected objects`}</span>
      {compact && group && ungroup}
      <HelpHint label="grouped objects">Grouped objects move and rotate together around one fixed pivot. Geometry stays independent unless explicitly linked. Ungroup keeps every object's placement.</HelpHint>
    </div>
    {(!compact || !group) && <div className="flex flex-wrap gap-2">
      {!group && <Button size="sm" variant="outline" onClick={() => bin.dispatch({ type: "GROUP_SELECTION", group: createPlacementGroup(selected, bin.spec, crypto.randomUUID()) })}><Group className="mr-1 h-3.5 w-3.5" />Group objects</Button>}
      {selected.some(objectGroup) && ungroup}
    </div>}
    {group && !compact && <p className="text-muted-foreground">Move and rotate together. Geometry links are separate.</p>}
  </section>;
}
