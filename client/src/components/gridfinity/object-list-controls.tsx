import { Children, isValidElement, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useSelectionInspector } from "./selection-inspector-context";

/** Shared inline naming behavior for pockets, finger access, and surface text. */
export function EditableObjectName({ name, kind, onRename, onDone }: {
  name: string;
  kind: "shape" | "finger-hole" | "surface-text";
  onRename: (name: string) => void;
  onDone: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState(name);
  const commit = () => {
    const trimmedName = draft.trim();
    if (trimmedName.length > 0 && trimmedName !== name) onRename(trimmedName);
    onDone();
  };
  return (
    <Input
      autoFocus
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onDone();
        }
      }}
      className={cn("min-w-0 flex-1 text-xs font-medium", kind === "finger-hole" ? "h-11" : "h-8")}
      aria-label={kind === "shape" ? "Pocket name" : kind === "finger-hole" ? "Finger access name" : "Surface text name"}
      data-testid={`input-${kind}-name`}
    />
  );
}

/** The tree stays readable; less frequent row actions remain keyboard reachable. */
export function ObjectActions({ name, children }: { name: string; children: ReactNode }): JSX.Element {
  const inspector = useSelectionInspector();
  const pendingAction = useRef<(() => void) | null>(null);
  if (!inspector) return <>{children}</>;
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="h-9 w-9 shrink-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" aria-label={`Actions for ${name}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" onCloseAutoFocus={event => {
      // Open the inline name editor only after the menu releases its focus trap.
      const action = pendingAction.current;
      pendingAction.current = null;
      if (action) { event.preventDefault(); action(); }
    }}>
      {Children.map(children, child => isValidElement<{ children: ReactNode; "aria-label": string; disabled?: boolean; onClick: () => void }>(child) &&
        <DropdownMenuItem disabled={child.props.disabled} aria-label={child.props["aria-label"]}
          className="min-h-9 gap-1.5 [@media(pointer:coarse)]:min-h-11" onSelect={() => { pendingAction.current = child.props.onClick; }}>
          {child.props.children}<span>{child.props["aria-label"]}</span>
        </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
