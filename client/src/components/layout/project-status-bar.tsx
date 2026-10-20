import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { projectActivityLabel, useProjectActivity, useProjectActivityActions } from "@/state/project-activity";
import { usePanelState } from "./panel-context";

/** Project identity remains visible with collapsed controls and on small screens. */
export function ProjectStatusBar() {
  const activity = useProjectActivity();
  const actions = useProjectActivityActions();
  const [location, navigate] = useLocation();
  const { setLibraryRequested } = usePanelState();
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const recoveries = activity?.recoveryBackups ?? [];
  useEffect(() => { if (recoveries.length < 2) setRecoveryOpen(false); }, [recoveries.length]);
  const name = activity?.name ?? "Untitled project";
  useEffect(() => {
    const previous = document.title;
    document.title = `${name} · ${location === "/bin" ? "Bin" : location === "/" ? "Trace" : "About"} · Pocketry`;
    return () => { document.title = previous; };
  }, [name, location]);
  if (!activity) return null;
  const openLibrary = () => { setLibraryRequested(true); navigate("/bin"); };
  const hasUnsavedWork = recoveries.length > 0 || (activity.status === "error" && activity.hasDocument);
  return <div className="shrink-0 border-b px-2 md:px-3" data-testid="global-project-status">
    <div className="flex min-h-12 items-center gap-2">
    <button type="button" className="min-h-11 min-w-0 flex-1 rounded px-1 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Manage project: ${name}`} aria-haspopup="dialog" onClick={openLibrary}>
      <span className="block truncate text-xs font-medium" title={name}>Project: {name}</span>
      <span role="status" className={`block text-xs ${activity.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>{projectActivityLabel(activity)}</span>
      {recoveries.length > 0 && <span className="block text-xs text-destructive">{recoveries.length === 1 ? `Unsaved work: ${recoveries[0].name}` : `${recoveries.length} unsaved versions available`}</span>}
    </button>
    {hasUnsavedWork && (recoveries.length < 2 ? <Button variant="outline" size="sm" className="h-auto min-h-11 max-w-40 shrink-0 whitespace-normal text-destructive"
      title={`Download unsaved work: ${recoveries[0]?.name ?? name}`}
      onClick={() => recoveries.length ? actions?.downloadRecovery(recoveries[0].id) : actions?.downloadBackup()}>Download unsaved work</Button> :
    <Dialog open={recoveryOpen} onOpenChange={setRecoveryOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm" className="h-auto min-h-11 max-w-40 shrink-0 whitespace-normal text-destructive">Download unsaved work</Button></DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Download unsaved work</DialogTitle>
          <DialogDescription>These edits could not be saved. Download them before closing or reloading this tab, then use Import Project in Bin to recover them.</DialogDescription>
        </DialogHeader>
        <section aria-label="Unsaved edit recovery" className="space-y-2">
          {recoveries.map(copy => <Button key={copy.id} variant="outline" className="h-auto min-h-11 w-full whitespace-normal" onClick={() => actions?.downloadRecovery(copy.id)}>Download unsaved edits: {copy.name}</Button>)}
        </section>
      </DialogContent>
    </Dialog>)}
    </div>
    {activity.error && <p role="alert" className="px-1 pb-2 text-xs text-destructive">{activity.error}</p>}
  </div>;
}
