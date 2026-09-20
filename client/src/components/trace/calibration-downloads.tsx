import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { downloadCalibrationTemplate } from "@/lib/calibrate/download-template";
import type { TemplatePaper } from "@/lib/calibrate/template";
import { ReferenceStripDownloads } from "./reference-strip-downloads";

/** A single compact entry point for the supported paper and 3D references. */
export function CalibrationDownloads({ onPaperSelected, onDetectMarkers, open: controlledOpen, onOpenChange, showLink = true }: {
  onPaperSelected?: (paper: TemplatePaper) => void;
  onDetectMarkers?: () => void;
  /** Keep the dialog mounted outside a transient tooltip when linking from one. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showLink?: boolean;
}): JSX.Element {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {showLink && (
        <p className="text-xs text-muted-foreground">
          <DialogTrigger asChild>
            <button type="button" className="font-medium text-primary underline underline-offset-2 hover:no-underline">
              Download calibration templates
            </button>
          </DialogTrigger>
        </p>
      )}
      <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Calibration templates</DialogTitle>
          <DialogDescription>
            Print at 100% and verify a known dimension before use. Paper sheets
            go beneath the tool; measurement aids sit on top near the feature you need to measure.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-sm font-medium">Paper sheets</p>
          <p className="text-xs text-muted-foreground">Experimental corner-marker layout. Keep all four markers visible.</p>
          <div className="flex flex-wrap gap-2">
            {(["a4", "letter"] as const).map((paper) => (
              <Button key={paper} variant="outline" size="sm"
                onClick={() => {
                  onPaperSelected?.(paper);
                  downloadCalibrationTemplate(`${paper}-experimental`);
                }} data-testid={`button-template-${paper}-experimental`}>
                {paper === "a4" ? "A4 PDF" : "US Letter PDF"}
              </Button>
            ))}
          </div>
        </div>
        <ReferenceStripDownloads />
        {onDetectMarkers && (
          <Button variant="outline" onClick={() => { setOpen(false); onDetectMarkers(); }}
            data-testid="button-detect-markers">
            Detect sheet or strip in this image
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
