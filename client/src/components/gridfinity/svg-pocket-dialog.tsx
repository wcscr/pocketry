import { useEffect, useMemo, useRef, useState } from "react";
import { importSvgShape } from "@/lib/geometry/svg-import";
import { parseCutoutPlacement } from "@shared/gridfinity/cutout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useBin } from "@/state/bin-store";
import { useShapeLibrary } from "@/state/shape-library";
import { useKeyboardViewport } from "@/hooks/use-keyboard-viewport";

/** Import closed vectors locally into an editable millimetre pocket. */
export function SvgPocketDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { spec, dispatch } = useBin();
  const { storeShape } = useShapeLibrary();
  const keyboard = useKeyboardViewport();
  const [svgText, setSvgText] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [width, setWidth] = useState("");
  const [depth, setDepth] = useState(String(Math.min(12, spec.heightUnits * 7 - 1)));
  const readVersion = useRef(0);
  useEffect(() => () => { readVersion.current++; }, []);
  const number = (value: string) => Number(value.trim().replace(",", "."));
  const imported = useMemo(() => {
    if (!svgText) return { shape: null, error: null };
    try {
      return { shape: importSvgShape(svgText, { name: fileName.replace(/\.svg$/i, "") || "SVG pocket",
        widthMm: width.trim() ? number(width) : undefined }), error: null };
    } catch (error) {
      return { shape: null, error: error instanceof Error ? error.message : "Unable to import SVG." };
    }
  }, [svgText, fileName, width]);
  const depthMm = number(depth);
  const validDepth = depth.trim() !== "" && Number.isFinite(depthMm) && depthMm > 0 && depthMm <= spec.heightUnits * 7;
  const readFile = async (file: File | undefined) => {
    const version = ++readVersion.current;
    setSvgText(""); setFileError(null); setFileName(file?.name ?? ""); setLoading(false);
    if (!file) return;
    if (file.size > 5_000_000) { setFileError("Choose an SVG smaller than 5 MB."); return; }
    setLoading(true);
    try {
      const text = await file.text();
      if (version === readVersion.current) setSvgText(text);
    } catch {
      if (version === readVersion.current) setFileError("Unable to read this file.");
    } finally {
      if (version === readVersion.current) setLoading(false);
    }
  };
  const add = () => {
    if (!imported.shape || !validDepth || loading || fileError) return;
    const id = crypto.randomUUID(), shape = { ...imported.shape, id };
    const cutout = parseCutoutPlacement({ id: `cutout-${id}`, shapeId: id,
      position: { x: 0, y: 0 }, depth: { mode: "mm", value: depthMm },
      // Preserve supplied outline and fit; rounding remains an explicit edit.
      cornerRoundMm: 0, topFilletMm: 0, bottomFilletMm: 0 });
    storeShape(shape);
    dispatch({ type: "ADD_PLACED", cutouts: [cutout], gridX: spec.gridX, gridY: spec.gridY, historyLabel: "Import SVG pocket" });
    dispatch({ type: "SET_VIEW_MODE", viewMode: "2d" });
    dispatch({ type: "SET_EDITOR_MODE", editorMode: "placement" });
    onClose();
  };
  const error = fileError ?? imported.error;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-w-sm" onOpenAutoFocus={event => event.preventDefault()}
      style={keyboard ? { top: keyboard.top + keyboard.height / 2, maxHeight: Math.max(1, keyboard.height - 32) } : undefined}>
      <DialogHeader><DialogTitle>Import SVG pocket</DialogTitle>
        <DialogDescription>Choose a closed object outline and its pocket depth. Files stay on your device.</DialogDescription></DialogHeader>
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); add(); }}>
        <label className="block space-y-1 text-sm">SVG outline
          <Input type="file" accept=".svg,image/svg+xml" onChange={event => { void readFile(event.target.files?.[0]); }} /></label>
        <label className="block space-y-1 text-sm">Object width override (mm, optional)
          <Input inputMode="decimal" enterKeyHint="next" value={width} onChange={event => setWidth(event.target.value)} placeholder="Use SVG physical dimensions" /></label>
        <p className="text-xs text-muted-foreground">Width uses the outline bounds, excluding canvas margins. Set it when the SVG has no physical units.</p>
        <label className="block space-y-1 text-sm">Pocket depth (mm)
          <Input inputMode="decimal" enterKeyHint="done" value={depth} onChange={event => setDepth(event.target.value)} /></label>
        {loading && <p role="status" className="text-xs">Reading SVG…</p>}
        {imported.shape && <p role="status" className="text-xs text-muted-foreground">Outline: {(imported.shape.bboxMm.maxX - imported.shape.bboxMm.minX).toFixed(2)} × {(imported.shape.bboxMm.maxY - imported.shape.bboxMm.minY).toFixed(2)} mm</p>}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        {!validDepth && <p role="status" className="text-xs text-destructive">Use a positive pocket depth up to {spec.heightUnits * 7} mm.</p>}
        <Button type="submit" className="min-h-11 w-full" disabled={!imported.shape || !validDepth || loading || !!fileError}>Place in center</Button>
      </form>
    </DialogContent>
  </Dialog>;
}
