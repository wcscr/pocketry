import {
  DEFAULT_OBLONG_DEEP_SCOOP_LENGTH_MM,
  DEFAULT_TOP_EDGE_FILLET_MM,
  defaultFingerAccessDepthMm,
} from "@shared/gridfinity/cutout";
import { useBin } from "@/state/bin-store";
import { useSelectionInspector } from "./selection-inspector-context";

/** Shared creation behavior for the list button and toolbar menu. */
export function useAddFingerAccess(onAdd?: () => void): () => void {
  const { spec, cutouts, dispatch } = useBin();
  const inspector = useSelectionInspector();
  return () => {
    onAdd?.();
    dispatch({ type: "SET_EDITOR_MODE", editorMode: "placement" });
    inspector?.setTool("properties");
    dispatch({ type: "ADD_FINGER_HOLE", hole: {
      id: crypto.randomUUID(), center: { x: 0, y: 0 }, diameterMm: 18,
      kind: "oblong-deep-scoop", slotEnds: "rounded", lengthMm: DEFAULT_OBLONG_DEEP_SCOOP_LENGTH_MM,
      depthMm: defaultFingerAccessDepthMm(spec, cutouts),
      topFilletMm: DEFAULT_TOP_EDGE_FILLET_MM, bottomFilletMm: 0,
    } });
  };
}
