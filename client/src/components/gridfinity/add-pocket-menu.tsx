import { useState } from "react";
import { BasicPocketDialog } from "./basic-pocket-dialog";
import { ChevronDown, CircleDot, Circle, RectangleHorizontal, Square, Type } from "lucide-react";
import { AddObjectButton } from "./add-object-button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BASIC_POCKET_LABELS, type BasicPocketShape } from "@/lib/gridfinity/basic-shape";
import { useBin } from "@/state/bin-store";
import { usePanelState } from "@/components/layout/panel-context";
import { useHasTouchInput, useIsMobile } from "@/hooks/use-mobile";
import { useAddSurfaceText } from "./use-add-surface-text";
import { useAddFingerAccess } from "./use-add-finger-access";

/** Pocket picker with optional object actions for the compact toolbar. */
export function AddPocketMenu({ label = "Add pocket", className, onStart, testId = "button-add-pocket", includeFingerAccess = false, iconOnly = false }: {
  label?: string; className?: string; onStart?: () => void; testId?: string; includeFingerAccess?: boolean; iconOnly?: boolean;
}): JSX.Element {
  const { spec, dispatch } = useBin();
  const addSurfaceText = useAddSurfaceText(onStart);
  const { setPanelOpen } = usePanelState();
  const isMobile = useIsMobile();
  const addFingerAccess = useAddFingerAccess(onStart);
  const hasTouch = useHasTouchInput();
  const [dimensionKind, setDimensionKind] = useState<BasicPocketShape | null>(null);
  const draw = (kind: BasicPocketShape) => {
    onStart?.();
    dispatch({ type: "SET_EDITOR_MODE", editorMode: `draw-${kind}` });
    dispatch({ type: "SET_VIEW_MODE", viewMode: "2d" });
    if (isMobile) setPanelOpen(false);
  };
  return <><DropdownMenu>
    <DropdownMenuTrigger asChild>
      <AddObjectButton className={className} data-testid={testId} title={label}>
        <span className={iconOnly ? "sr-only" : undefined}>{label}</span>{includeFingerAccess && !iconOnly && <ChevronDown className="h-4 w-4" aria-hidden />}
      </AddObjectButton>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start">
      {(["rectangle", "square", "circle"] as const).map((kind: BasicPocketShape) => {
        const Icon = kind === "circle" ? Circle : kind === "square" ? Square : RectangleHorizontal;
        return <DropdownMenuItem key={kind} className="[@media(pointer:coarse)]:min-h-11" onSelect={() => {
          onStart?.();
          if (isMobile || hasTouch) setDimensionKind(kind);
          else draw(kind);
        }}><Icon className="mr-2 h-4 w-4" />{BASIC_POCKET_LABELS[kind]}{includeFingerAccess ? " pocket" : ""}</DropdownMenuItem>;
      })}
      {includeFingerAccess && <>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="[@media(pointer:coarse)]:min-h-11" onSelect={addFingerAccess}>
          <CircleDot className="mr-2 h-4 w-4" />Finger access
        </DropdownMenuItem>
        <DropdownMenuItem className="[@media(pointer:coarse)]:min-h-11" disabled={spec.surfaceTexts.length >= 32} onSelect={addSurfaceText}>
          <Type className="mr-2 h-4 w-4" />Surface text
        </DropdownMenuItem>
      </>}
    </DropdownMenuContent>
  </DropdownMenu>
    {dimensionKind && <BasicPocketDialog key={dimensionKind} kind={dimensionKind}
      onClose={() => { setDimensionKind(null); if (isMobile) setPanelOpen(false); }}
      onDraw={() => { draw(dimensionKind); setDimensionKind(null); }} />}
  </>;
}
