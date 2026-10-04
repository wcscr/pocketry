import {
  useEffect,
  useContext,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
} from "react";

import { Input } from "@/components/ui/input";
import { NumericEditContext, type NumericEditSession } from "./numeric-edit-context";

export interface DraftNumberInputProps
  extends Omit<
    ComponentProps<typeof Input>,
    "defaultValue" | "onChange" | "type" | "value"
  > {
  value: number;
  /** Round only the display; focusing and leaving it alone preserves stored precision. */
  displayPrecision?: number;
  /** A selection can have different stored values; an explicit edit applies to all. */
  mixed?: boolean;
  onValueChange: (value: number) => void;
  /** Called only when a valid draft is explicitly committed by blur or Enter. */
  onValueCommit?: (value: number) => void;
  onValueCancel?: (value: number) => void;
  /** Applied before a valid draft is committed (for angle wrapping, for example). */
  normalize?: (value: number) => number;
}

/**
 * A controlled number input with a local text draft.
 *
 * Numeric application state cannot represent the empty string a person needs
 * while replacing the final digit. Keeping that intermediate value here lets
 * the field be cleared and retyped without weakening the validated store.
 */
export function DraftNumberInput({
  value,
  displayPrecision,
  mixed = false,
  onValueChange,
  onValueCommit,
  onValueCancel,
  normalize = (next) => next,
  min,
  max,
  onBlur,
  onFocus,
  onKeyDown,
  ...props
}: DraftNumberInputProps): JSX.Element {
  const format = (number: number) => mixed ? "" : String(
    displayPrecision === undefined ? number : Number(number.toFixed(displayPrecision)),
  );
  const [draft, setDraft] = useState(format(value));
  const [error, setError] = useState<string | null>(null);
  const coordinator = useContext(NumericEditContext);
  const owner = useId();
  const session = useRef<NumericEditSession | null>(null);
  const initial = useRef(value);
  const draftRef = useRef(draft);
  const focused = useRef(false);
  const edited = useRef(false);
  const previewed = useRef(false);

  useEffect(() => {
    if (session.current && !session.current.isCurrent()) { focused.current = false; session.current = null; }
    if (!focused.current) { draftRef.current = format(value); setDraft(format(value)); }
  }, [value, displayPrecision, mixed]);

  const parsedDraft = (text: string): number | null => {
    if (text.trim() === "") return null;
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) return null;
    const normalized = normalize(parsed);
    if (!Number.isFinite(normalized)) return null;
    if (typeof min === "number" && normalized < min) return null;
    if (typeof max === "number" && normalized > max) return null;
    return normalized;
  };

  const rangeMessage = `Enter a number${typeof min === "number" ? ` from ${min}` : ""}${typeof max === "number" ? ` to ${max}` : ""}.`;
  const begin = () => {
    if (focused.current && (!session.current || session.current.isCurrent())) return;
    focused.current = true;
    initial.current = value;
    draftRef.current = format(value);
    edited.current = false;
    previewed.current = false;
    session.current = coordinator?.begin(owner) ?? null;
    setError(null);
  };
  const finish = (cancel = false) => {
    if (!focused.current) return;
    focused.current = false;
    const current = session.current;
    session.current = null;
    if (current && !current.isCurrent()) { setDraft(format(value)); return; }
    if (!edited.current) { current?.cancel(() => {}); return; }
    const parsed = parsedDraft(draftRef.current);
    const restore = () => { if (previewed.current) (onValueCancel ?? onValueChange)(initial.current); };
    if (cancel || parsed === null) {
      if (current) current.cancel(restore); else restore();
      setDraft(format(initial.current));
      if (!cancel) setError(`${rangeMessage} Change not applied.`);
    } else {
      const update = () => {
        if (edited.current && (mixed || parsed !== initial.current)) {
          onValueChange(parsed);
          onValueCommit?.(parsed);
        }
      };
      if (current) current.commit(update); else update();
      setDraft(format(edited.current ? parsed : initial.current));
    }
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;
  // A pane can unmount before the browser dispatches blur.
  useEffect(() => () => finishRef.current(), []);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Enter") {
      event.preventDefault(); event.stopPropagation();
      if (parsedDraft(draftRef.current) === null) { setError(rangeMessage); return; }
      finish();
      event.currentTarget.blur();
    }
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      finish(true);
      event.currentTarget.blur();
    }
  };

  return (
    <span className="relative inline-flex min-w-0 flex-col" style={{ maxWidth: "100%" }}>
    <Input
      {...props}
      type="number"
      min={min}
      max={max}
      value={draft}
      aria-invalid={!!error}
      aria-describedby={error ? `${owner}-error` : props["aria-describedby"]}
      title={error ?? props.title}
      onFocus={(event) => {
        begin();
        onFocus?.(event);
      }}
      onChange={(event) => {
        begin();
        edited.current = true;
        const next = event.target.value;
        draftRef.current = next;
        setDraft(next);
        setError(null);
        const parsed = parsedDraft(next);
        if (parsed !== null && parsed !== initial.current) previewed.current = true;
        if (session.current) session.current.preview(parsed !== null, parsed === null ? undefined : () => onValueChange(parsed));
        else if (parsed !== null) onValueChange(parsed);
      }}
      onBlur={(event) => {
        finish();
        onBlur?.(event);
      }}
      onKeyDown={handleKeyDown}
    />
    {error && <span id={`${owner}-error`} role="status" className="text-[10px] leading-tight text-destructive">{error}</span>}
    </span>
  );
}
