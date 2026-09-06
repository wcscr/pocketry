import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
} from "react";

import { Input } from "@/components/ui/input";

export interface DraftNumberInputProps
  extends Omit<
    ComponentProps<typeof Input>,
    "defaultValue" | "onChange" | "type" | "value"
  > {
  value: number;
  /** Round only the display; focusing and leaving it alone preserves stored precision. */
  displayPrecision?: number;
  onValueChange: (value: number) => void;
  /** Called only when a valid draft is explicitly committed by blur or Enter. */
  onValueCommit?: (value: number) => void;
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
  onValueChange,
  onValueCommit,
  normalize = (next) => next,
  min,
  max,
  onBlur,
  onFocus,
  onKeyDown,
  ...props
}: DraftNumberInputProps): JSX.Element {
  const format = (number: number) => String(
    displayPrecision === undefined ? number : Number(number.toFixed(displayPrecision)),
  );
  const [draft, setDraft] = useState(format(value));
  const focused = useRef(false);
  const edited = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(format(value));
  }, [value, displayPrecision]);

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

  const commit = (text: string, revertInvalid: boolean) => {
    const parsed = parsedDraft(text);
    if (parsed === null) {
      if (revertInvalid) setDraft(format(value));
      return;
    }
    onValueChange(parsed);
    if (revertInvalid) {
      setDraft(format(parsed));
      onValueCommit?.(parsed);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Enter") event.currentTarget.blur();
    if (event.key === "Escape") {
      setDraft(format(value));
      event.currentTarget.blur();
    }
  };

  return (
    <Input
      {...props}
      type="number"
      min={min}
      max={max}
      value={draft}
      onFocus={(event) => {
        focused.current = true;
        edited.current = false;
        onFocus?.(event);
      }}
      onChange={(event) => {
        edited.current = true;
        const next = event.target.value;
        setDraft(next);
        commit(next, false);
      }}
      onBlur={(event) => {
        focused.current = false;
        if (displayPrecision === undefined || edited.current) commit(draft, true);
        onBlur?.(event);
      }}
      onKeyDown={handleKeyDown}
    />
  );
}
