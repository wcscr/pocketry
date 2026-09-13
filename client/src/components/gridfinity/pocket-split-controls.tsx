import type { CutoutPlacement } from "@shared/gridfinity/cutout";
import { Button } from "@/components/ui/button";
import { useBin } from "@/state/bin-store";

/** Split is part of one pocket, so it needs no extra list or placement tools. */
export function PocketSplitControls({ cutout }: { cutout: CutoutPlacement }): JSX.Element {
  const { selectedPocketSection, editorMode, dispatch } = useBin();
  const begin = () => {
    dispatch({ type: "SET_VIEW_MODE", viewMode: "2d" });
    dispatch({ type: "SET_EDITOR_MODE", editorMode: "split" });
  };
  return <div className="space-y-2" aria-label="Pocket sections">
    {cutout.split && <div className="flex gap-1" role="group" aria-label="Section to edit">
      {([0, 1] as const).map(index => <Button key={index} type="button" size="sm"
        className="h-8 flex-1 text-xs" variant={selectedPocketSection === index ? "secondary" : "outline"}
        aria-pressed={selectedPocketSection === index}
        onClick={() => dispatch({ type: "SELECT_CUTOUT", id: cutout.id, section: index })}>
        Section {index === 0 ? "A" : "B"}
      </Button>)}
    </div>}
    <div className="flex flex-wrap gap-1">
      <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={begin} disabled={editorMode === "split"}>
        {cutout.split ? "Redraw split" : "Split pocket"}
      </Button>
      {cutout.split && <Button type="button" size="sm" variant="ghost" className="h-7 text-xs"
        title="Restore the original whole-pocket depth"
        onClick={() => {
          dispatch({ type: "UPDATE_CUTOUT", id: cutout.id, patch: { split: undefined }, historyLabel: "Remove pocket split" });
          dispatch({ type: "SET_EDITOR_MODE", editorMode: "placement" });
        }}>Remove split</Button>}
      {editorMode === "split" && <Button type="button" size="sm" variant="ghost" className="h-7 text-xs"
        onClick={() => dispatch({ type: "SET_EDITOR_MODE", editorMode: "placement" })}>Cancel split</Button>}
    </div>
    {cutout.split && <p className="text-[11px] text-muted-foreground">Depth applies to the selected section. Size and edges apply to the whole pocket.</p>}
  </div>;
}
