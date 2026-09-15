import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
    /** Fill a signed horizontal control from zero, with a neutral-position tick. */
    centerOrigin?: boolean;
  }
>(({ className, centerOrigin = false, ...props }, ref) => {
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  const position = (value: number) => Math.max(0, Math.min(100, (value - min) / (max - min) * 100));
  const zero = position(0);
  const current = position(props.value?.[0] ?? props.defaultValue?.[0] ?? 0);
  return (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary">
      {centerOrigin ? <>
        <span className="absolute h-full bg-primary" style={{ left: `${Math.min(zero, current)}%`, width: `${Math.abs(current - zero)}%` }} />
        <span className="absolute h-full w-px bg-foreground/50" style={{ left: `${zero}%` }} />
      </> : <SliderPrimitive.Range className="absolute h-full bg-primary" />}
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb aria-label={props["aria-label"]} aria-labelledby={props["aria-labelledby"]} className="block h-5 w-5 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50" />
  </SliderPrimitive.Root>
  )
})
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
