import { modelPlacementDefaults } from "@shared/gridfinity/model-placement";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DraftNumberInput } from "@/components/ui/draft-number-input";
import { MODEL_MAX_FILE_BYTES, MODEL_MAX_TRIANGLES, modelDimensions, type ModelUnits } from "@shared/gridfinity/model-pocket";
import { parseCutoutPlacement, type TracedShape } from "@shared/gridfinity/cutout";
import { readModelFile } from "@/lib/gridfinity/model-worker-client";
import { useShapeLibrary } from "@/state/shape-library";
import { useBin } from "@/state/bin-store";
import { useExperimentalFeatures } from "@/state/experimental-features";

/** Confirm file units and real dimensions before adding any persistent object. */
export function ModelImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { spec, dispatch } = useBin();
  const { enabled: experimentalEnabled } = useExperimentalFeatures();
  const active = open && experimentalEnabled;
  useEffect(() => {
    if (open && !experimentalEnabled) onOpenChange(false);
  }, [open, experimentalEnabled, onOpenChange]);
  const { storeShape } = useShapeLibrary();
  const [file, setFile] = useState<File>();
  const [units, setUnits] = useState<ModelUnits>("mm");
  const [shape, setShape] = useState<TracedShape>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    setShape(undefined); setError("");
    if (!active || !file) { setBusy(false); return; }
    if (!/\.stl$/i.test(file.name) || file.size > MODEL_MAX_FILE_BYTES) {
      setBusy(false); setError("Choose an STL file smaller than 10 MiB."); return;
    }
    const controller = new AbortController();
    setBusy(true);
    void readModelFile(file, units, controller.signal).then(result => {
      if (!controller.signal.aborted) setShape(result);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not import this STL.");
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [active, file, units]);
  const dimensions = shape?.model ? modelDimensions(shape.model).map(n => n * scale) : null;
  const add = () => {
    if (!active || !shape || !dimensions || busy) return;
    const cutout = parseCutoutPlacement({ id: `cutout-${crypto.randomUUID()}`, shapeId: shape.id,
      position: { x: 0, y: 0 }, ...modelPlacementDefaults(shape.model!, spec, scale) });
    storeShape(shape);
    dispatch({ type: "ADD_PLACED", cutouts: [cutout], gridX: spec.gridX, gridY: spec.gridY, historyLabel: "Import model pocket" });
    dispatch({ type: "SET_EDITOR_MODE", editorMode: "placement" });
    dispatch({ type: "SET_VIEW_MODE", viewMode: "3d" });
    onOpenChange(false); setFile(undefined); setShape(undefined); setScale(1);
  };
  return <Dialog open={active} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader><DialogTitle>Import 3D model</DialogTitle>
        <DialogDescription>Import a watertight STL. Pocketry clears the space the model needs as it is lowered into the bin.</DialogDescription></DialogHeader>
      <div className="space-y-4">
        <Label className="block space-y-2"><span>STL file</span><Input type="file" accept=".stl" aria-label="STL file" onChange={e => { setShape(undefined); setFile(e.target.files?.[0]); }} /></Label>
        <p className="text-xs text-muted-foreground">Binary or ASCII STL, up to {MODEL_MAX_TRIANGLES.toLocaleString()} triangles and 10 MiB. Files stay in your browser.</p>
        <Label className="flex items-center gap-3">File units
          <select aria-label="Model file units" value={units} className="h-9 flex-1 rounded-md border bg-background px-2" onChange={e => { setShape(undefined); setUnits(e.target.value as ModelUnits); }}>
            <option value="mm">Millimetres</option><option value="cm">Centimetres</option><option value="in">Inches</option><option value="m">Metres</option>
          </select>
        </Label>
        <p className="text-xs text-muted-foreground">STL does not record units. Confirm these match the software that created your file.</p>
        {busy && <p role="status">Checking model…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {dimensions && <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm" data-testid="model-import-dimensions">X × Y × Z: {dimensions.map(n => n.toFixed(2)).join(" × ")} mm</p>
          <Label className="flex items-center gap-3">Scale (%)<DraftNumberInput aria-label="Import model scale percent" value={scale * 100} min={5} max={2000} step={5} onValueChange={n => setScale(n / 100)} /></Label>
        </div>}
        <p className="text-xs text-muted-foreground">The pocket keeps a shaped seat and clears the model’s insertion path along its rotated axis. After adding, set its angle and depth, or choose Vertical drop-in.</p>
      </div>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!shape || busy} onClick={add}>Add model pocket</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
