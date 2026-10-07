import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface MaterialColorSource {
  id: string;
  label: string;
  color: string;
}

/** Copy a color value once; later edits to the source stay independent. */
export function MaterialColorSwatch({
  id, label, value, sources, disabled = false, onChange,
}: {
  id: string;
  label: string;
  value: string;
  sources: readonly MaterialColorSource[];
  disabled?: boolean;
  onChange: (color: string) => void;
}): JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <input
        id={id}
        type="color"
        value={value}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        className={cn(
          "h-7 w-10 shrink-0 cursor-pointer rounded-md border bg-background p-0.5 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11",
          disabled && "cursor-not-allowed opacity-40",
        )}
        aria-label={`${label} color`}
        title={`Choose ${label.toLowerCase()} color`}
        data-testid={id}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" disabled={disabled}
            className="h-7 w-7 shrink-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
            aria-label={`Use color from another feature for ${label.toLowerCase()}`}
            title="Use color from…" data-testid={`${id}-copy-from`}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Use color from</DropdownMenuLabel>
          {sources.filter(source => source.id !== id).map(source => (
            <DropdownMenuItem key={source.id} onSelect={() => onChange(source.color)}
              className="gap-2 [@media(pointer:coarse)]:min-h-11">
              <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded border"
                style={{ backgroundColor: source.color }} />
              <span>{source.label}</span>
              <span className="ml-auto pl-3 font-mono text-xs text-muted-foreground">{source.color.toUpperCase()}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
