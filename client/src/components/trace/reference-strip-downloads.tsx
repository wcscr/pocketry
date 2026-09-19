import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { downloadMeasurementAid, downloadReferenceStripPdf } from "@/lib/calibrate/download-reference-strip";
import { MEASUREMENT_AID_LENGTHS, type MeasurementAidLength } from "@/lib/calibrate/reference-strip";

/** Shared by the empty workspace and Scale so printing never requires a photo. */
export function ReferenceStripDownloads(): JSX.Element {
  const [length, setLength] = useState<MeasurementAidLength>(100);
  const [building, setBuilding] = useState<"3mf" | "stl" | null>(null);
  const { toast } = useToast();

  async function download(format: "3mf" | "stl"): Promise<void> {
    setBuilding(format);
    try {
      await downloadMeasurementAid(length, format);
    } catch (error) {
      toast({ title: "Measurement aid download failed", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally { setBuilding(null); }
  }

  return (
    <div className="space-y-2 rounded-md border p-3 text-left">
      <p className="text-sm font-medium">Printable measurement aids</p>
      <p className="text-xs text-muted-foreground">
        Place an aid flat on top of a thick tool, near the edge you want to
        measure. Keep both markers and the outline visible and shoot straight down.
        Each length has its own markers for automatic recognition.
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Measurement aid length">
        {MEASUREMENT_AID_LENGTHS.map((size) => (
          <Button key={size} variant={length === size ? "default" : "outline"} size="sm"
            aria-pressed={length === size} disabled={building !== null} onClick={() => setLength(size)}>
            {size} mm
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {length} × 15 × 2 mm · labelled · 1 mm ruler ticks · chamfered underside · rounded top edge
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={building !== null} onClick={() => void download("3mf")}>
          {building === "3mf" ? "Building 3MF…" : "3MF · two colours"}
        </Button>
        <Button variant="outline" size="sm" disabled={building !== null} onClick={() => void download("stl")}>
          {building === "stl" ? "Building STL…" : "STL · recessed markings"}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Print flat at 100% and verify the end-to-end length. For 3MF, keep the parts
        assembled and assign opaque white to the carrier and black to the markings.
        STL has no colours: fill the recessed markers, label and ticks with matte
        black paint. Use one aid per photo and check a tool dimension before printing a pocket.
      </p>
      <details className="text-xs">
        <summary className="cursor-pointer font-medium">Paper reference strip · 100 × 20 mm</summary>
        <p className="my-2 text-muted-foreground">Print at 100%, cut out the strip and mount it flat on thin backing. Its markers are also recognized.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadReferenceStripPdf("a4")}>Strip PDF · A4</Button>
          <Button variant="outline" size="sm" onClick={() => downloadReferenceStripPdf("letter")}>Strip PDF · US Letter</Button>
        </div>
      </details>
    </div>
  );
}
