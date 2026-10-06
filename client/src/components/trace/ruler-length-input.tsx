import { calibrationFromDraft, hasCalibrationEndpoints } from "@shared/geometry/scale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTrace } from "@/state/trace-store";

/** Both the inline desktop control and mobile primary action share validation. */
export function useRulerConfirmation() {
  const { rulerLengthInput, draftCalibration, calibration, calibrationSource, dispatch } = useTrace();
  // A decimal keyboard may supply the user's locale separator.
  const lengthMm = Number(rulerLengthInput.trim().replace(",", "."));
  const valid = rulerLengthInput.trim() !== "" && Number.isFinite(lengthMm) && lengthMm > 0;
  const draft = valid ? calibrationFromDraft(draftCalibration, lengthMm) : null;
  const current = valid && calibrationSource === "manual" && calibration ? { ...calibration, lengthMm } : null;
  const canConfirmScale = hasCalibrationEndpoints(draftCalibration) || (calibrationSource === "manual" && calibration !== null);
  const canConfirm = valid && !!(draft ?? current);
  const confirm = () => {
    if (!canConfirm) return false;
    dispatch({ type: "SET_RULER_LENGTH", rulerLengthMm: lengthMm });
    dispatch({ type: "SET_CALIBRATION", calibration: draft ?? current });
    return true;
  };
  return { valid, canConfirm, canConfirmScale, confirm };
}

/** Draft text survives drawer/orientation changes. A visible button remains
 * available even on keyboards that do not provide a Done/Enter action.
 */
export function RulerLengthInput({ id, disabled = false, showConfirm = true, onConfirmed }: {
  id: string; disabled?: boolean; showConfirm?: boolean; onConfirmed?: () => void;
}): JSX.Element {
  const { rulerLengthInput, dispatch } = useTrace();
  const { valid, canConfirm, canConfirmScale, confirm } = useRulerConfirmation();
  const submit = () => {
    if (disabled || !confirm()) return;
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
    onConfirmed?.();
  };
  return <div className="space-y-1"><div className="flex items-end gap-2">
    <Input id={id} className="min-w-0 flex-1" type="text" inputMode="decimal" enterKeyHint="done"
      value={rulerLengthInput} disabled={disabled}
      aria-invalid={!valid} aria-describedby={!valid ? `${id}-error` : undefined}
      onChange={(event) => dispatch({ type: "SET_RULER_LENGTH_INPUT", value: event.target.value })}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submit(); } }} />
    {showConfirm && canConfirmScale && <Button className="min-h-11 shrink-0" disabled={disabled || !canConfirm}
      onClick={submit}>Confirm scale</Button>}
  </div>
    {!valid && <p id={`${id}-error`} className="text-xs text-destructive">Enter a length greater than zero.</p>}
  </div>;
}
