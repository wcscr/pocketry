import type { Calibration } from "@shared/geometry/scale";
import { ScanLine, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PerspectiveProposal } from "@/lib/calibrate/perspective";
import { referenceStripFromRulerLength } from "@/lib/calibrate/reference-strip";
import { templateDisplayName, type TemplateVariant } from "@/lib/calibrate/template";
import { useTrace } from "@/state/trace-store";
import { CalibrationAccuracyHint } from "./calibration-accuracy-hint";

export interface AutoCalibrationOptionsProps {
  onSetManually: () => void;
  onApplyPerspective: (proposal: PerspectiveProposal, template: TemplateVariant, scale?: boolean | Calibration) => void;
  onDetectMarkers: () => void;
}

const actionClass = "h-auto min-h-11 w-full whitespace-normal break-words px-2 py-2 text-sm leading-tight";

/** One reference decision for desktop controls and the mobile canvas workflow. */
export function AutoCalibrationOptions({ onSetManually, onApplyPerspective, onDetectMarkers }: AutoCalibrationOptionsProps): JSX.Element | null {
  const { dispatch, pendingAutoCalibration: aid, pendingPaperCalibration: paper,
    pendingPerspective: perspective, pendingCalibrationSource: source, pendingAidRequiresPerspective,
    processing } = useTrace();
  if (!aid) return null;
  const template = perspective?.template ?? perspective?.paper;
  const hasPerspective = !!perspective && !!template;
  const paperAction = hasPerspective && (
    <Button variant={paper ? "outline" : "default"} size="sm" className={actionClass}
      disabled={processing} data-testid="button-apply-auto-perspective"
      onClick={() => onApplyPerspective(perspective, template, true)}>
      <ScanLine className="mr-1.5 h-4 w-4 shrink-0" />
      {paper ? "Correct perspective & use paper scale" : "Correct perspective & use scale"}
    </Button>
  );
  return (
    <div className="space-y-2 rounded-md border border-amber-400/50 bg-amber-50/70 p-3 dark:bg-amber-950/20"
      data-testid="auto-calibration-options">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
        <Sparkles className="h-4 w-4 shrink-0" />
        {paper ? "Paper and measurement aid detected" : source === "strip" ? "Scale detected from the reference strip" : "Scale detected from the sheet"}
      </div>
      {hasPerspective ? paper ? (
        <Button size="sm" className={actionClass} disabled={processing}
          data-testid="button-correct-perspective-aid-scale"
          onClick={() => onApplyPerspective(perspective, template, aid)}>
          Correct perspective &amp; use aid scale
        </Button>
      ) : paperAction : (
        <Button size="sm" className={actionClass} disabled={processing || pendingAidRequiresPerspective}
          data-testid="button-accept-auto-scale"
          onClick={() => dispatch({ type: "ACCEPT_AUTO_CALIBRATION" })}>
          Accept detected scale
        </Button>
      )}
      <Button variant="outline" size="sm" className={actionClass} disabled={processing}
        data-testid="button-set-scale" onClick={onSetManually}>Set manually instead</Button>
      <details data-testid="advanced-calibration-options" className="text-xs">
        <summary className="min-h-9 cursor-pointer list-item rounded py-1 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:min-h-11">Advanced</summary>
        <div className="space-y-2 pt-2">
          {paper && <>
            {!pendingAidRequiresPerspective && <Button variant="outline" size="sm" className={actionClass} disabled={processing}
              data-testid="button-use-aid-scale" onClick={() => dispatch({ type: "ACCEPT_AUTO_CALIBRATION", source: "strip" })}>Use aid scale only</Button>}
            {paperAction}
          </>}
          {hasPerspective && <>
            <Button variant="outline" size="sm" className={actionClass} disabled={processing}
              data-testid="button-correct-auto-perspective-only"
              onClick={() => onApplyPerspective(perspective, template, false)}>Correct perspective only</Button>
            <Button variant="outline" size="sm" className={actionClass} disabled={processing}
              data-testid="button-accept-auto-scale" onClick={() => dispatch({ type: "ACCEPT_AUTO_CALIBRATION", source: "sheet" })}>
              {paper ? "Use paper scale only" : "Use scale without correction"}
            </Button>
          </>}
          <Button variant="outline" size="sm" className={actionClass} disabled={processing}
            onClick={onDetectMarkers} data-testid="button-detect-markers">Detect references again</Button>
          <Button variant="ghost" size="sm" className={actionClass} disabled={processing}
            onClick={() => dispatch({ type: "DISMISS_AUTO_CALIBRATION" })}>Dismiss detected scale</Button>
        </div>
      </details>
      <CalibrationAccuracyHint>
        <p>{paper
          ? "The recommended option corrects perspective using the paper corners and sets scale from the aid at the tool’s height."
          : "Review the ruler on the image before accepting the detected scale."}
          {template && <> {templateDisplayName(template)} template detected automatically.</>}
        </p>
        {source === "strip" && <p>The ruler joins the marker centres, {aid.lengthMm} mm apart
          on the {referenceStripFromRulerLength(aid.lengthMm)?.lengthMm} mm strip.
          Keep the aid near the tool edge you need to fit and verify that dimension.
          {pendingAidRequiresPerspective && " This tilted aid needs paper perspective correction before its scale can be used."}
        </p>}
      </CalibrationAccuracyHint>
    </div>
  );
}
