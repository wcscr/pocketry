import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  downloadReferenceStripPdf,
  downloadReferenceStripThreeMf,
} from "@/lib/calibrate/download-reference-strip";

/** Shared by the empty workspace and Scale so printing never requires a photo. */
export function ReferenceStripDownloads(): JSX.Element {
  const [building, setBuilding] = useState(false);
  const { toast } = useToast();

  async function downloadThreeMf(): Promise<void> {
    setBuilding(true);
    try {
      await downloadReferenceStripThreeMf();
    } catch (error) {
      toast({
        title: "Strip download failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border p-3 text-left">
      <p className="text-sm font-medium">Object reference strip</p>
      <p className="text-xs text-muted-foreground">
        For thick tools: place this 100 mm strip flat on top, near the edge you
        want to measure. Keep both markers and the tool outline visible and
        shoot straight down. Trace detects the strip automatically.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => downloadReferenceStripPdf("a4")}
        >
          Strip PDF · A4
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => downloadReferenceStripPdf("letter")}
        >
          Strip PDF · US Letter
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={building}
          onClick={() => void downloadThreeMf()}
        >
          {building ? "Building strip…" : "Strip 3MF · two colours"}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Print at 100% and verify the 100 mm length. Mount paper flat on thin
        backing. The 3MF is 1.2 mm thick; assign opaque white to the carrier and
        black to the markers, and print flat with markers facing up. Scale follows
        the marker height: check a tool dimension before printing a pocket.
      </p>
    </div>
  );
}
