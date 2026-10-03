import { surfaceTextSchema } from "@shared/gridfinity/surface-text";
import { revealPanelSection } from "@/components/layout/panel-section";
import { usePanelState } from "@/components/layout/panel-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { useBin } from "@/state/bin-store";
import { useExperimentalFeatures } from "@/state/experimental-features";
import { useSelectionInspector } from "./selection-inspector-context";

/** Both creation entry points select the new label and open Layout for placement. */
export function useAddSurfaceText(onAdd?: () => void): () => void {
  const { spec, dispatch } = useBin();
  const { enabled } = useExperimentalFeatures();
  const { setPanelOpen } = usePanelState();
  const isMobile = useIsMobile();
  const inspector = useSelectionInspector();
  return () => {
    if (!enabled || spec.surfaceTexts.length >= 32) return;
    onAdd?.();
    const label = surfaceTextSchema.parse({ id: crypto.randomUUID(), text: "Text", font: "helvetiker", position: { x: 0, y: 0 } });
    dispatch({ type: "PATCH_SPEC", patch: { surfaceTexts: [...spec.surfaceTexts, label] }, historyLabel: "Add surface text" });
    dispatch({ type: "SET_EDITOR_MODE", editorMode: "placement" });
    dispatch({ type: "SET_VIEW_MODE", viewMode: "2d" });
    dispatch({ type: "SELECT_SURFACE_TEXT", id: label.id });
    revealPanelSection("bin-settings-text", [{ id: "bin-settings-text" }]);
    inspector?.setTool("properties");
    setPanelOpen(!isMobile);
  };
}
