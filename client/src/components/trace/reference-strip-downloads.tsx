import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { downloadMeasurementAid } from "@/lib/calibrate/download-reference-strip";
import { MEASUREMENT_AID_LENGTHS, type MeasurementAidLength } from "@/lib/calibrate/reference-strip";

/** Shared by the empty workspace and Scale so printing never requires a photo. */
export function ReferenceStripDownloads(): JSX.Element {
  const [length, setLength] = useState<MeasurementAidLength>(100);
  const [building, setBuilding] = useState(false);
  const { toast } = useToast();

  async function download(): Promise<void> {
    setBuilding(true);
    try {
      await downloadMeasurementAid(length);
    } catch (error) {
      toast({ title: "Measurement aid download failed", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally { setBuilding(false); }
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
            aria-pressed={length === size} disabled={building} onClick={() => setLength(size)}>
            {size} mm
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {length} × 15 × 2 mm · labelled · 1 mm ruler ticks · chamfered underside · rounded top edge
      </p>
      <Button variant="outline" size="sm" disabled={building} onClick={() => void download()}>
        {building ? "Building 3MF…" : "3MF · two colours"}
      </Button>
      <p className="text-[11px] text-muted-foreground">
        Print flat at 100% and verify the end-to-end length. Keep the parts assembled
        and assign opaque white to the carrier and black to the markings. Use one
        aid per photo and check a tool dimension before printing a pocket.
      </p>
    </div>
  );
}
