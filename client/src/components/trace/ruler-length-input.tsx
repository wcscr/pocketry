import { calibrationFromDraft, hasCalibrationEndpoints } from "@shared/geometry/scale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTrace } from "@/state/trace-store";

/** Shared draft text survives drawer and mobile layout remounts until confirmed. */
export function RulerLengthInput({ id, disabled = false }: { id: string; disabled?: boolean }): JSX.Element {
  const trace = useTrace();
  const { rulerLengthInput, draftCalibration, calibration, calibrationSource, dispatch } = trace;
  const lengthMm = Number(rulerLengthInput);
  const valid = rulerLengthInput.trim() !== "" && Number.isFinite(lengthMm) && lengthMm > 0;
  const draft = valid ? calibrationFromDraft(draftCalibration, lengthMm) : null;
  const current = valid && calibrationSource === "manual" && calibration
    ? { ...calibration, lengthMm } : null;
  const canConfirmScale = hasCalibrationEndpoints(draftCalibration) || (calibrationSource === "manual" && calibration !== null);
  const confirm = () => {
    if (!valid || disabled) return;
    dispatch({ type: "SET_RULER_LENGTH", rulerLengthMm: lengthMm });
    if (draft ?? current) dispatch({ type: "SET_CALIBRATION", calibration: draft ?? current });
  };
  return <div className="space-y-1"><div className="flex items-end gap-2">
    <Input id={id} className="min-w-0 flex-1" type="number" inputMode="decimal" enterKeyHint="done"
      min="0" step="any" value={rulerLengthInput} disabled={disabled}
      aria-invalid={!valid} aria-describedby={!valid ? `${id}-error` : undefined}
      onChange={(event) => dispatch({ type: "SET_RULER_LENGTH_INPUT", value: event.target.value })}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); confirm(); event.currentTarget.blur(); }
      }} />
    {canConfirmScale && <Button className="min-h-11 shrink-0" disabled={disabled || !valid || !(draft ?? current)}
      onClick={confirm}>Confirm scale</Button>}
  </div>
    {!valid && <p id={`${id}-error`} className="text-xs text-destructive">Enter a length greater than zero.</p>}
  </div>;
}
