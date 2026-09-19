import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

interface LabelledSliderProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  /** Fired on release, for anything too expensive to run per frame. */
  onCommit?: (value: number) => void;
  disabled?: boolean;
  hint?: string;
  className?: string;
  touchTarget?: boolean;
}

export function LabelledSlider({
  id,
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  onCommit,
  disabled,
  hint,
  className,
  touchTarget = false,
}: LabelledSliderProps): JSX.Element {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {format(value)}
        </span>
      </div>
      <Slider
        className={touchTarget ? "min-h-8" : undefined}
        id={id}
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={[value]}
        disabled={disabled}
        onValueChange={(values) => onChange(values[0])}
        onValueCommit={(values) => onCommit?.(values[0])}
      />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
