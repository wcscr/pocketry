import { Check, Eraser, MousePointer2, Scan } from "lucide-react";
import { Button } from "@/components/ui/button";

const tools = [
  { value: "edit", label: "Edit points", icon: MousePointer2 },
  { value: "select", label: "Select multiple", icon: Scan },
  { value: "erase", label: "Erase points", icon: Eraser },
] as const;

export type OutlineTool = typeof tools[number]["value"];

interface Props {
  active: OutlineTool;
  processing: boolean;
  onSelect: (tool: OutlineTool) => void;
  onDone: () => void;
}

/** Keep the same buttons mounted while the contextual controls above them change. */
export function OutlineToolbar({ active, processing, onSelect, onDone }: Props) {
  return <div role="group" aria-label="Outline editing tools" className="trace-outline-toolbar rounded-lg border bg-background p-1 shadow-md">
    {tools.map(({ value, label, icon: Icon }) =>
      <Button key={value} type="button" size="sm" variant={active === value ? "default" : "ghost"}
        aria-pressed={active === value} disabled={processing && value === "erase"}
        onClick={event => {
          if (event.detail > 0) event.currentTarget.blur();
          onSelect(value);
        }}>
        <Icon aria-hidden="true" />{label}
      </Button>
    )}
    <Button type="button" size="sm" variant="outline" onClick={onDone}><Check aria-hidden="true" />Done</Button>
  </div>;
}
