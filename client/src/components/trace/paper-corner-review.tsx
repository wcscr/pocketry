import type { Calibration } from "@shared/geometry/scale";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { proposalFromPageCorners, type PerspectiveProposal } from "@/lib/calibrate/perspective";
import type { TemplatePaper, TemplateVariant } from "@/lib/calibrate/template";
import { useTrace } from "@/state/trace-store";

export function PaperSizePicker({ id, confirm = false }: { id: string; confirm?: boolean }): JSX.Element {
  const { dispatch, manualPerspectivePaper } = useTrace();
  return <div className="min-w-0 space-y-1">
    <Label htmlFor={id} className="text-xs">{confirm ? "Confirm paper size" : "Paper size"}</Label>
    <Select value={manualPerspectivePaper ?? ""} onValueChange={(value) =>
      dispatch({ type: "SET_PERSPECTIVE_PAPER", paper: value as TemplatePaper })}>
      <SelectTrigger id={id} className="w-full"><SelectValue placeholder="Choose paper size" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="a4">A4</SelectItem>
        <SelectItem value="letter">US Letter</SelectItem>
      </SelectContent>
    </Select>
  </div>;
}

/** Ask for the real paper size while leaving the canvas handles available. */
export function PaperCornerReview({ mobile = false, onApplyPerspective }: {
  mobile?: boolean;
  onApplyPerspective: (proposal: PerspectiveProposal, template: TemplateVariant, scale?: boolean | Calibration) => void;
}): JSX.Element {
  const { dispatch, manualPerspectivePaper: paper, manualPerspectivePoints: points,
    pendingAutoCalibration, pendingCalibrationSource, pendingAidRequiresPerspective, processing } = useTrace();
  const proposal = proposalFromPageCorners(points);
  const aid = pendingCalibrationSource === "strip" ? pendingAutoCalibration : null;
  const apply = (scale?: boolean | Calibration) => {
    if (!proposal || !paper) return;
    if (scale === undefined) onApplyPerspective(proposal, paper);
    else onApplyPerspective(proposal, paper, scale);
  };
  return <div className="space-y-2" data-testid={mobile ? "mobile-paper-corner-review" : "paper-corner-review"}>
    {(!mobile || !proposal) && <p role="status" className="text-xs text-muted-foreground">
      {proposal ? "Four corners selected. Drag any numbered handle to adjust it."
        : "Drag the handles so the corners form a single page."}
    </p>}
    <div className={mobile ? "grid grid-cols-2 items-end gap-2" : "space-y-2"}>
      <PaperSizePicker id={mobile ? "mobile-perspective-paper" : "manual-perspective-paper"} confirm />
      <Button size="sm" className={mobile ? "min-h-10 whitespace-normal" : "w-full"}
        disabled={processing || !paper || !proposal}
        data-testid={mobile ? "button-apply-mobile-paper-perspective" : "button-apply-manual-perspective"}
        onClick={() => apply(aid ?? undefined)}>
        {aid ? "Correct perspective & use aid scale" : mobile ? "Apply correction" : "Apply perspective correction"}
      </Button>
    </div>
    {aid && !pendingAidRequiresPerspective && <Button variant="outline" size="sm" className="w-full"
      disabled={processing} onClick={() => dispatch({ type: "ACCEPT_AUTO_CALIBRATION", source: "strip" })}>
      Use aid scale only
    </Button>}
    {!mobile && <Button variant="outline" size="sm" className="h-auto min-h-9 w-full whitespace-normal"
      disabled={processing || !paper || !proposal}
      data-testid="button-correct-manual-perspective-only" onClick={() => apply(false)}>
      Correct perspective only
    </Button>}
  </div>;
}
