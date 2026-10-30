import { ChevronDown } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { HelpHint } from "@/components/ui/help-hint";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** A feature switch and its independent disclosure share one compact settings row. */
export function FeatureSettings({ label, description, checked, onChange, settingsLabel, summary, testId, children }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  settingsLabel: string;
  summary: string;
  testId: string;
  children: ReactNode;
}): JSX.Element {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (!checked) setExpanded(false); }, [checked]);
  return <div className="min-w-0">
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {checked ? <button type="button" aria-label={`${label} settings`}
          aria-expanded={expanded} aria-controls={panelId}
          data-testid={`${testId}-trigger`}
          className="-ml-1 flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left text-xs font-medium text-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setExpanded(value => !value)}>
          <span className="min-w-0 flex-1">{label}</span>
          <span className="shrink-0 text-[11px] font-normal text-muted-foreground" aria-hidden="true">{summary}</span>
          <ChevronDown aria-hidden="true" className={cn("h-3.5 w-3.5 shrink-0 transition-transform motion-reduce:transition-none", !expanded && "-rotate-90")} />
        </button> : <span className="text-xs font-medium">{label}</span>}
        <HelpHint label={label.toLowerCase()}>{description}</HelpHint>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
    {checked && <div id={panelId} role="group" aria-label={settingsLabel} data-testid={testId}
      hidden={!expanded} className="mt-1 space-y-2 border-t border-border/60 pb-1 pt-3">
      {children}
    </div>}
  </div>;
}
