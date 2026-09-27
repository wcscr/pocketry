import {
  DEFAULT_OBLONG_DEEP_SCOOP_LENGTH_MM,
  DEFAULT_TOP_EDGE_FILLET_MM,
  defaultFingerAccessDepthMm,
} from "@shared/gridfinity/cutout";
import { useBin } from "@/state/bin-store";
import { AddObjectButton } from "./add-object-button";
import { useSelectionInspector } from "./selection-inspector-context";

/** List and toolbar entry points create the same access and select its properties. */
export function AddFingerAccessButton({ label = "Add finger access", className, onAdd, testId = "button-add-finger-hole" }: {
  label?: string; className?: string; onAdd?: () => void; testId?: string;
}): JSX.Element {
  const { spec, cutouts, dispatch } = useBin();
  const inspector = useSelectionInspector();
  return <AddObjectButton className={className} data-testid={testId} onClick={() => {
    onAdd?.();
    dispatch({ type: "SET_EDITOR_MODE", editorMode: "placement" });
    inspector?.setTool("properties");
    dispatch({ type: "ADD_FINGER_HOLE", hole: {
      id: crypto.randomUUID(), center: { x: 0, y: 0 }, diameterMm: 18,
      kind: "oblong-deep-scoop", slotEnds: "rounded", lengthMm: DEFAULT_OBLONG_DEEP_SCOOP_LENGTH_MM,
      depthMm: defaultFingerAccessDepthMm(spec, cutouts),
      topFilletMm: DEFAULT_TOP_EDGE_FILLET_MM, bottomFilletMm: 0,
    } });
  }}>{label}</AddObjectButton>;
}
