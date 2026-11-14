import { useEffect, useMemo, useRef, useState } from "react";
import { Upload } from "lucide-react";

import { mmPerPixel } from "@shared/geometry/scale";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useKeyboardViewport } from "@/hooks/use-keyboard-viewport";
import { placeSvgOutline } from "@/lib/geometry/trace-outline-import";
import { hasPendingManualCalibration, useTrace } from "@/state/trace-store";

/**
 * Brings an existing SVG outline into Trace so its points can be adjusted over
 * the photo. The button is available exactly when Add contour is; the import is
 * one committed outline edit, so Undo restores whatever it replaced or joined.
 */
export function TraceOutlineImport({ onImported }: {
  /** Called after a successful import, e.g. to bring the canvas into view. */
  onImported?: () => void;
}): JSX.Element {
  const trace = useTrace();
  // Opening is bound to the photo: replacing or rotating it dismisses the dialog.
  const [openRevision, setOpenRevision] = useState<number | null>(null);
  const unavailable = trace.imageSize.width <= 0 || trace.processing || trace.pendingAutoCalibration !== null ||
    hasPendingManualCalibration(trace) || trace.mode === "perspective";
  return <>
    <Button variant="outline" size="sm" className="w-full" disabled={unavailable}
      onClick={() => setOpenRevision(trace.sourceRevision)} data-testid="button-import-outline">
      <Upload className="h-4 w-4" />Import outline
    </Button>
    {openRevision === trace.sourceRevision && <TraceOutlineImportDialog blocked={unavailable}
      onClose={() => setOpenRevision(null)} onImported={onImported} />}
  </>;
}

function TraceOutlineImportDialog({ blocked, onClose, onImported }: {
  blocked: boolean;
  onClose: () => void;
  onImported?: () => void;
}): JSX.Element {
  const { dispatch, outline, curves, margin, imageSize, calibration, region, perspectiveCorrection } = useTrace();
  const keyboard = useKeyboardViewport();
  const [svgText, setSvgText] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [width, setWidth] = useState("");
  const [useFileSize, setUseFileSize] = useState(false);
  const [fitToOutline, setFitToOutline] = useState(true);
  const readVersion = useRef(0);
  useEffect(() => () => { readVersion.current++; }, []);

  const mmPerPx = mmPerPixel(calibration);
  const visibleBounds = (!perspectiveCorrection?.showFullPhoto && perspectiveCorrection?.paperBounds) || null;
  const imported = useMemo(() => {
    if (!svgText) return { placed: null, error: null };
    try {
      return { placed: placeSvgOutline(svgText, { imageSize, mmPerPx, region, visibleBounds, fitTo: outline }, {
        placement: useFileSize ? "true-size" : undefined,
        fit: fitToOutline,
        // The override only applies where the field is offered.
        widthMm: !useFileSize && width.trim() ? Number(width.trim().replace(",", ".")) : undefined,
      }), error: null };
    } catch (error) {
      return { placed: null, error: error instanceof Error ? error.message : "Unable to import this SVG." };
    }
  }, [svgText, imageSize, mmPerPx, region, visibleBounds, outline, useFileSize, fitToOutline, width]);
  const { placed } = imported;

  const readFile = async (file: File | undefined) => {
    const version = ++readVersion.current;
    setSvgText(""); setFileError(null); setLoading(false); setWidth(""); setUseFileSize(false); setFitToOutline(true);
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

  // Editable curves cannot carry a trace margin, so the store declines the edit; say so here instead.
  const curvesNeedZeroMargin = Boolean(curves) && (margin ?? 0) !== 0;
  const ready = placed !== null && !loading && !fileError && !blocked && !curvesNeedZeroMargin;
  const commit = (replace: boolean) => {
    if (!placed || !ready) return;
    // One edit, like Add contour: it lands in editing with the imported contour selected.
    dispatch({ type: "OUTLINE_IMPORTED", outline: placed.outline, replace });
    onClose();
    onImported?.();
  };

  const error = fileError ?? imported.error
    ?? (curvesNeedZeroMargin ? "Set Margin to zero before importing while Editable curves are on." : null);
  const contours = placed ? placed.outline.reduce((count, shape) => count + 1 + shape.holes.length, 0) : 0;
  const size = !placed ? "" : mmPerPx !== null
    ? `${(placed.sizePx.width * mmPerPx).toFixed(2)} × ${(placed.sizePx.height * mmPerPx).toFixed(2)} mm`
    : `${Math.round(placed.sizePx.width)} × ${Math.round(placed.sizePx.height)} px`;
  // Keep the choice reachable after choosing it, even if that placement then fails.
  const offerFileSize = placed?.scaleMismatch || useFileSize;
  const offerWidth = svgText !== "" && !useFileSize && placed?.placement !== "photo";

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-w-sm" onOpenAutoFocus={event => event.preventDefault()}
      style={keyboard ? { top: keyboard.top + keyboard.height / 2, maxHeight: Math.max(1, keyboard.height - 32) } : undefined}>
      <DialogHeader><DialogTitle>Import outline</DialogTitle>
        <DialogDescription>Choose a closed SVG outline to adjust over this photo. An outline exported from this photo returns to its place; any other is placed at true size and can be turned to fit the current outline. Files stay on your device.</DialogDescription></DialogHeader>
      <div className="space-y-3">
        <label className="block space-y-1 text-sm">SVG outline
          <Input type="file" accept=".svg,image/svg+xml" onChange={event => { void readFile(event.target.files?.[0]); }} /></label>
        {offerFileSize && <div className="space-y-1.5 rounded-md border p-2" data-testid="import-outline-scale-choice">
          <p className="text-xs text-muted-foreground">
            {placed?.fileMmPerPx && mmPerPx !== null
              ? `This file was saved at ${placed.fileMmPerPx.toFixed(3)} mm/px; this trace is set to ${mmPerPx.toFixed(3)} mm/px. `
              : "This file was saved at a different scale than this trace. "}
            Its contours keep their positions over the photo and take this trace's scale.
          </p>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="import-outline-file-size" className="text-xs">Use the file's size instead</Label>
            <Switch id="import-outline-file-size" checked={useFileSize} onCheckedChange={setUseFileSize} />
          </div>
        </div>}
        {placed?.fitAvailable && <div className="flex items-center justify-between gap-2" data-testid="import-outline-fit-choice">
          <Label htmlFor="import-outline-fit" className="text-xs">Turn and move it to fit the current outline</Label>
          <Switch id="import-outline-fit" checked={fitToOutline} onCheckedChange={setFitToOutline} />
        </div>}
        {offerWidth && <>
          <label className="block space-y-1 text-sm">Object width override (mm, optional)
            <Input inputMode="decimal" enterKeyHint="done" value={width} onChange={event => setWidth(event.target.value)} placeholder="Use SVG physical dimensions" /></label>
          <p className="text-xs text-muted-foreground">Width uses the outline bounds, excluding canvas margins. Set it when the SVG has no physical units.</p>
        </>}
        {loading && <p role="status" className="text-xs">Reading SVG…</p>}
        {placed && <p role="status" className="text-xs text-muted-foreground" data-testid="import-outline-summary">
          Outline: {size}, {contours} contour{contours === 1 ? "" : "s"}.{" "}
          {placed.placement === "photo"
            ? "It matches this photo, so its contours keep their positions."
            : placed.fit
              ? `It will be placed at true size, turned ${placed.fit.degrees.toFixed(1)}° to fit the current outline (typical gap ${mmPerPx !== null
                ? `${(placed.fit.typicalGapPx * mmPerPx).toFixed(2)} mm` : `${placed.fit.typicalGapPx.toFixed(1)} px`}). Move & rotate adjusts it afterward.`
              : `It will be placed at true size in the center of the ${region ? "region" : "photo"}. Move & rotate adjusts it afterward.`}
        </p>}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        {outline.length > 0 ? <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" className="min-h-11 whitespace-normal leading-tight" disabled={!ready}
            onClick={() => commit(false)} data-testid="button-import-outline-add">Add to outline</Button>
          <Button type="button" className="min-h-11 whitespace-normal leading-tight" disabled={!ready}
            onClick={() => commit(true)} data-testid="button-import-outline-replace">Replace outline</Button>
        </div> : <Button type="button" className="min-h-11 w-full" disabled={!ready}
          onClick={() => commit(true)} data-testid="button-import-outline-confirm">Import outline</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}
