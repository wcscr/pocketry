import { useRef } from "react";
import { Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ProjectLibraryItem } from "@/lib/project/persist";
import { cn } from "@/lib/utils";

/** A compact design row with secondary actions outside the reading path. */
export function LibraryProjectRow({ project, active, selected, ready, busy, onSelect, onOpen, onRename, onDuplicate, onRemove }: {
  project: ProjectLibraryItem;
  active: boolean;
  selected: boolean;
  ready: boolean;
  busy: boolean;
  onSelect(): void;
  onOpen(): void;
  onRename(): void;
  onDuplicate(): void;
  onRemove(): void;
}): JSX.Element {
  const row = useRef<HTMLDivElement>(null);
  const pendingAction = useRef<(() => void) | null>(null);
  const date = new Date(project.updatedAt);
  const validDate = !Number.isNaN(date.getTime());
  const unavailable = project.unavailable === "newer-version"
    ? "Saved by a newer Pocketry version. Reload Pocketry to update."
    : project.unavailable ? "This project could not be read by this version of Pocketry." : null;
  const disabled = !ready || busy;
  const actions = [
    { key: "rename", label: "Rename", ariaLabel: `Rename ${project.name}`, icon: Pencil, disabled: disabled || !!unavailable, run: onRename },
    { key: "duplicate", label: "Copy", ariaLabel: `Duplicate ${project.name}`, icon: Copy, disabled: disabled || !!unavailable, run: () => { row.current?.focus(); onDuplicate(); } },
    { key: "remove", label: "Remove", ariaLabel: `Remove ${project.name} from library`, icon: Trash2, disabled: disabled || active, run: onRemove },
  ];
  return <div
    ref={row}
    className={cn("flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", selected && "border-primary/50 bg-primary/5")}
    data-testid={`library-project-${project.id}`} data-project-id={project.id} data-selected={selected}
    role="group" aria-label={project.name} tabIndex={0}
    onFocus={event => { if (event.currentTarget.contains(event.target)) onSelect(); }}
    onClick={event => {
      if (!(event.target instanceof Element) || !event.currentTarget.contains(event.target)) return;
      onSelect();
      if (!event.target.closest("button")) event.currentTarget.focus();
    }}
    onKeyDown={event => {
      if (event.target !== event.currentTarget || event.key !== "Enter") return;
      event.preventDefault();
      onOpen();
    }}
    onDoubleClick={event => {
      if (!(event.target instanceof Element) || !event.currentTarget.contains(event.target) || event.target.closest("button")) return;
      onOpen();
    }}
  >
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium" title={project.name}>{project.name}</p>
      <p className="truncate text-[11px] text-muted-foreground" title={unavailable ? `${unavailable} Kept intact and included in library backups.` : validDate ? `Updated ${date.toLocaleString()}` : undefined}>
        {unavailable ? <>{project.unavailable === "newer-version" ? "Newer version" : "Unreadable"} · kept in backups<span className="sr-only">. {unavailable}</span></>
          : <>Updated {validDate ? <time dateTime={project.updatedAt}>{date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</time> : "recently"}</>}
      </p>
    </div>
    <Button size="sm" variant={active ? "secondary" : "outline"}
      className="h-8 shrink-0 px-2 text-xs [@media(pointer:coarse)]:h-11"
      disabled={disabled || active || !!unavailable} onClick={onOpen}
      aria-label={unavailable ? `${project.name} cannot be opened in this version` : active ? `${project.name} is currently open` : `Open ${project.name}`}
      data-testid={`button-open-project-${project.id}`}
    >{active ? "Current" : "Open"}</Button>
    <DropdownMenu onOpenChange={open => { if (open) onSelect(); }}>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" disabled={disabled}
          className="h-8 w-8 shrink-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
          aria-label={`Actions for ${project.name}`} title={`Actions for ${project.name}`} data-testid={`button-project-actions-${project.id}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={event => {
        // Release the menu's focus trap before opening another dialog.
        const action = pendingAction.current;
        pendingAction.current = null;
        if (action) { event.preventDefault(); action(); }
      }}>
        {actions.map(action => <DropdownMenuItem key={action.key} asChild disabled={action.disabled}
          className={cn("min-h-9 gap-2 [@media(pointer:coarse)]:min-h-11", action.key === "remove" && "text-destructive focus:text-destructive")}
          onSelect={() => { pendingAction.current = action.run; }}>
          <button type="button" className="w-full" disabled={action.disabled} aria-label={action.ariaLabel} data-testid={`button-${action.key}-project-${project.id}`}>
            <action.icon className="h-4 w-4" />{action.label}
          </button>
        </DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
