import { ChevronDown, Circle, Plus, RectangleHorizontal, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BASIC_POCKET_LABELS, type BasicPocketShape } from "@/lib/gridfinity/basic-shape";
import { useBin } from "@/state/bin-store";
import { usePanelState } from "@/components/layout/panel-context";
import { useIsMobile } from "@/hooks/use-mobile";

/** Starts the same direct-drawing workflow from Layout or the pocket properties panel. */
export function AddPocketMenu(): JSX.Element {
  const { dispatch } = useBin();
  const { setPanelOpen } = usePanelState();
  const isMobile = useIsMobile();
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="outline" size="sm" className="gap-1.5 bg-background/90 [@media(pointer:coarse)]:min-h-11">
        <Plus className="h-3.5 w-3.5" />Add simple pocket<ChevronDown className="h-3.5 w-3.5" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start">
      {(["rectangle", "square", "circle"] as const).map((kind: BasicPocketShape) => {
        const Icon = kind === "circle" ? Circle : kind === "square" ? Square : RectangleHorizontal;
        return <DropdownMenuItem key={kind} className="[@media(pointer:coarse)]:min-h-11" onSelect={() => {
          dispatch({ type: "SET_EDITOR_MODE", editorMode: `draw-${kind}` });
          dispatch({ type: "SET_VIEW_MODE", viewMode: "2d" });
          if (isMobile) setPanelOpen(false);
        }}><Icon className="mr-2 h-4 w-4" />{BASIC_POCKET_LABELS[kind]}</DropdownMenuItem>;
      })}
    </DropdownMenuContent>
  </DropdownMenu>;
}
