import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { downloadCalibrationTemplate } from "@/lib/calibrate/download-template";
import { downloadMeasurementAidsPdf } from "@/lib/calibrate/download-reference-strip";
import type { TemplatePaper } from "@/lib/calibrate/template";
import { ReferenceStripDownloads } from "./reference-strip-downloads";

/** A single compact entry point for the supported paper and 3D references. */
export function CalibrationDownloads({ onPaperSelected, open: controlledOpen, onOpenChange, showLink = true }: {
  onPaperSelected?: (paper: TemplatePaper) => void;
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
              Download calibration aids
            </button>
          </DialogTrigger>
        </p>
      )}
      <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Calibration aids</DialogTitle>
          <DialogDescription>
            Print at 100% and verify a known dimension before use. Paper sheets
            go beneath the tool; measurement aids sit on top near the feature you need to measure.
          </DialogDescription>
        </DialogHeader>
        <section className="space-y-3 rounded-md border p-3 text-left" aria-label="Paper printable aids">
          <h3 className="text-sm font-medium">Paper printable aids</h3>
          <div className="space-y-2">
            <p className="text-xs font-medium">Calibration sheets</p>
            <p className="text-xs text-muted-foreground">Experimental corner-marker layout. Place beneath the tool and keep all four markers visible.</p>
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
          <div className="space-y-2">
            <p className="text-xs font-medium">Measurement aids</p>
            <p className="text-xs text-muted-foreground">50, 100 and 200 mm aids on one sheet. Print in landscape at 100%, verify the lengths, then cut out one aid per photo.</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Download paper measurement aids">
              {(["a4", "letter"] as const).map((paper) => (
                <Button key={paper} variant="outline" size="sm"
                  aria-label={`Download all three measurement aids as ${paper === "a4" ? "A4" : "US Letter"} PDF`}
                  onClick={() => downloadMeasurementAidsPdf(paper)}>
                  {paper === "a4" ? "A4 PDF" : "US Letter PDF"}
                </Button>
              ))}
            </div>
          </div>
        </section>
        <ReferenceStripDownloads />
      </DialogContent>
    </Dialog>
  );
}
