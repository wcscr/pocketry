import { CircleDot, Scissors } from "lucide-react";
import { pocketName } from "@shared/gridfinity/cutout";
import { cn } from "@/lib/utils";
import { useBin } from "@/state/bin-store";
import { useShapeLibrary } from "@/state/shape-library";
import { useSelectionInspector } from "./selection-inspector-context";

/** Compact workflow navigation shares the inspector's selection, not its editors. */
export function BinObjectList({ kind }: { kind: "pocket" | "finger" }): JSX.Element {
  const { cutouts, fingerHoles, selection, dispatch } = useBin();
  const { shapes } = useShapeLibrary();
  const inspector = useSelectionInspector();
  const shapesById = new Map(shapes.map(shape => [shape.id, shape]));
  const items = kind === "pocket"
    ? cutouts.map(cutout => ({ id: cutout.id, name: pocketName(cutout, shapesById.get(cutout.shapeId)) }))
    : fingerHoles.map((hole, index) => ({ id: hole.id, name: hole.name ?? `Finger access ${index + 1}` }));
  const Icon = kind === "pocket" ? Scissors : CircleDot;
  return <div className="space-y-1" role="group" aria-label={kind === "pocket" ? "Pockets in bin" : "Finger access in bin"}>
    {items.map(item => {
      const selected = selection.some(ref => ref.kind === kind && ref.id === item.id);
      return <button key={item.id} type="button"
        className={cn("flex min-h-8 w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:min-h-11",
          selected ? kind === "pocket" ? "border-violet-500/50 bg-violet-500/10 text-violet-700 dark:text-violet-300"
            : "border-cyan-500/50 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
            : "border-transparent hover:bg-accent")}
        aria-label={`${item.name} — select ${kind === "pocket" ? "pocket" : "finger access"}`}
        aria-pressed={selected} aria-controls="objects-panel" title={item.name}
        data-testid={`workflow-select-${kind}-${item.id}`}
        onClick={event => {
          dispatch({ type: kind === "pocket" ? "SELECT_CUTOUT" : "SELECT_FINGER_HOLE", id: item.id,
            additive: event.shiftKey || event.metaKey || event.ctrlKey });
          inspector?.setTool("properties");
        }}>
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className={cn("min-w-0 truncate", selected && "font-medium")}>{item.name}</span>
      </button>;
    })}
  </div>;
}
