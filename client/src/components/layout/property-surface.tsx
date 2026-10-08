import type { HTMLAttributes } from "react";
import type { PanelTone } from "./panel-section";
import { cn } from "@/lib/utils";

/** One visual language for single-object, batch, bin, and action properties.
 * Nested groups inherit the enclosing workflow color; labels also identify it. */
export function PropertySurface({ tone = "slate", className, ...props }: HTMLAttributes<HTMLDivElement> & { tone?: PanelTone }): JSX.Element {
  return <div {...props} data-property-tone={tone} data-property-surface className={cn("property-surface space-y-3 rounded-lg border p-3", className)} />;
}
