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
  const [backupsOpen, setBackupsOpen] = useState(false);
  const name = activity?.name ?? "Untitled project";
  useEffect(() => {
    const previous = document.title;
    document.title = `${name} · ${location === "/bin" ? "Bin" : location === "/" ? "Trace" : "About"} · Pocketry`;
    return () => { document.title = previous; };
  }, [name, location]);
  if (!activity) return null;
  const openLibrary = () => { setBackupsOpen(false); setLibraryRequested(true); navigate("/bin"); };
  return <div className="flex min-h-12 shrink-0 items-center gap-2 border-b px-2 md:px-3" data-testid="global-project-status">
    <button type="button" className="min-h-11 min-w-0 flex-1 rounded px-1 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Manage project: ${name}`} aria-haspopup="dialog" onClick={openLibrary}>
      <span className="block truncate text-xs font-medium" title={name}>Bin project: {name}</span>
      <span role="status" className={`block text-xs ${activity.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>{projectActivityLabel(activity)}</span>
    </button>
    <Dialog open={backupsOpen} onOpenChange={setBackupsOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm" className="min-h-11 shrink-0">Backups</Button></DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Projects stay in this browser</DialogTitle>
          <DialogDescription>Projects are saved on this device, in this browser. They do not sync to another browser or device. Clearing site data or closing a private window can remove them.</DialogDescription>
        </DialogHeader>
        {activity.error && <p role="alert" className="text-sm text-destructive">{activity.error}</p>}
        <p className="text-sm">Download a backup after important changes. A project backup keeps the bin, its pockets and edit history; it does not include the original Trace photo.</p>
        <Button disabled={!activity.hasDocument || activity.status === "loading"} onClick={() => actions?.downloadBackup()}>Download current project backup</Button>
        <p className="text-sm text-muted-foreground">Export library backs up named projects. An unnamed draft needs its own project backup.</p>
        <Button variant="outline" onClick={openLibrary}>Manage projects and library backups</Button>
      </DialogContent>
    </Dialog>
  </div>;
}
