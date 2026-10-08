import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { downloadMeasurementAid } from "@/lib/calibrate/download-reference-strip";
import { MEASUREMENT_AID_LENGTHS, type MeasurementAidLength } from "@/lib/calibrate/reference-strip";

/** Shared by the empty workspace and Scale so printing never requires a photo. */
export function ReferenceStripDownloads(): JSX.Element {
  const [building, setBuilding] = useState<MeasurementAidLength | null>(null);
  const { toast } = useToast();

  async function download(length: MeasurementAidLength): Promise<void> {
    setBuilding(length);
    try {
      await downloadMeasurementAid(length);
    } catch (error) {
      toast({ title: "Measurement aid download failed", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally { setBuilding(null); }
  }

  return (
    <section className="space-y-2 rounded-md border p-3 text-left" aria-label="3D printable aids">
      <h3 className="text-sm font-medium">3D printable aids</h3>
      <p className="text-xs text-muted-foreground">
        Place an aid flat on top of a thick tool, near the edge you want to
        measure. Keep both markers and the outline visible and shoot straight down.
        Each length has its own markers for automatic recognition.
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Download a measurement aid as 3MF">
        {MEASUREMENT_AID_LENGTHS.map((size) => (
          <Button key={size} variant="outline" size="sm"
            aria-label={`Download ${size} mm measurement aid as 3MF`}
            disabled={building !== null} onClick={() => void download(size)}>
            {building === size ? `Building ${size} mm…` : `${size} mm 3MF`}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        15 mm wide × 2 mm thick · labelled · 1 mm ruler ticks · chamfered underside · rounded top edge
      </p>
      <p className="text-[11px] text-muted-foreground">
        Two-colour 3MF. Print flat at 100% and verify the end-to-end length. Keep the parts assembled
        and assign opaque white to the carrier and black to the markings. Use one
        aid per photo and check a tool dimension before printing a pocket.
      </p>
    </section>
  );
}
