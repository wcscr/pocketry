import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { HARDWARE_SYMBOLS, HARDWARE_SYMBOL_SOURCE, hardwareSymbol, type HardwareSymbolId } from "@shared/gridfinity/hardware-symbols";
import type { Ring } from "@shared/geometry/types";
import { outlineBounds } from "@/lib/geometry/outline";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

function SymbolPreview({ id }: { id: HardwareSymbolId }): JSX.Element {
  const { outline } = hardwareSymbol(id);
  const bounds = outlineBounds(outline)!;
  const path = (ring: Ring) => `M${ring.map(p => `${p.x},${-p.y}`).join("L")}Z`;
  return <svg aria-hidden="true" data-symbol-preview="" viewBox={`${bounds.minX - 0.06} ${-bounds.maxY - 0.06} ${bounds.maxX - bounds.minX + 0.12} ${bounds.maxY - bounds.minY + 0.12}`}
    className="h-6 w-9 shrink-0" fill="currentColor" fillRule="nonzero">
    {outline.map((shape, i) => <path key={i} d={[shape.outer, ...shape.holes].map(path).join("")} />)}
  </svg>;
}

export function SurfaceTextSymbolPicker({ symbol, canRemove, id, onChange }: {
  symbol?: HardwareSymbolId; canRemove: boolean; id: string;
  onChange: (symbol: HardwareSymbolId | undefined) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const choose = (value: HardwareSymbolId | undefined) => { onChange(value); setOpen(false); };
  return <div className="space-y-1">
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="text-xs">Symbol</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild><Button id={id} role="combobox" aria-label="Hardware symbol" aria-expanded={open} variant="outline"
          className="h-9 min-w-0 flex-1 justify-between gap-2 px-2 font-normal [&_[data-symbol-preview]]:h-6 [&_[data-symbol-preview]]:w-9 [@media(pointer:coarse)]:min-h-11">
          {symbol && <SymbolPreview id={symbol} />}<span className="flex-1 truncate text-left">{symbol ? hardwareSymbol(symbol).name : "None"}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button></PopoverTrigger>
        <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-0">
          <Command label="Hardware symbols">
            <CommandInput aria-label="Search hardware symbols" placeholder="Search nuts, bolts, drives…" />
            <CommandList aria-label="Hardware symbols" className="max-h-[min(300px,45dvh)]">
              <CommandEmpty>No symbols match.</CommandEmpty>
              <CommandGroup>
                <CommandItem value="None" disabled={!canRemove} onSelect={() => choose(undefined)} className="min-h-11">
                  <Check className={`h-4 w-4 ${symbol ? "opacity-0" : "opacity-100"}`} />None
                </CommandItem>
                {HARDWARE_SYMBOLS.map(item => <CommandItem key={item.id} value={item.name} keywords={[item.keywords]}
                  onSelect={() => choose(item.id)} className="min-h-11 gap-2">
                  <Check className={`h-4 w-4 shrink-0 ${symbol === item.id ? "opacity-100" : "opacity-0"}`} />
                  <SymbolPreview id={item.id} /><span>{item.name}</span>
                </CommandItem>)}
              </CommandGroup>
            </CommandList>
          </Command>
          <div className="space-y-1 border-t p-2 text-xs text-muted-foreground">
            {!canRemove && symbol && <p>Add wording before removing the symbol.</p>}
            <p>Symbols from <a href={HARDWARE_SYMBOL_SOURCE} target="_blank" rel="noreferrer" className="underline underline-offset-2">GFLabel</a> by Nicholas Devenish ·{" "}
              <a href="/licenses/gflabel.txt" target="_blank" rel="noreferrer" className="underline underline-offset-2">BSD-3-Clause</a></p>
          </div>
        </PopoverContent>
      </Popover>
    </div>
    <p className="text-[11px] text-muted-foreground">Place a symbol before wording, or clear wording to use it alone.</p>
  </div>;
}
