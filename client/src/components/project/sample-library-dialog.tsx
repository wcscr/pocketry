import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { loadSampleLibrary, type SampleLibrary, type SampleProject } from "@/lib/project/samples";

interface SampleLibraryDialogProps {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSample: (project: SampleProject) => void;
  onImportAll: (library: SampleLibrary) => void;
}

/** Browse first; importing an example always goes through the host's save guard. */
export function SampleLibraryDialog({ open, busy, onOpenChange, onOpenSample, onImportAll }: SampleLibraryDialogProps) {
  const [library, setLibrary] = useState<SampleLibrary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open || library) return;
    let cancelled = false;
    setError(null);
    void loadSampleLibrary().then(value => {
      if (!cancelled) setLibrary(value);
    }).catch(cause => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "The sample library could not be loaded.");
    });
    return () => { cancelled = true; };
  }, [open, library, retry]);

  return <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next); }}>
    <DialogContent className="flex max-w-xl flex-col overflow-hidden p-4 sm:p-6">
      <DialogHeader>
        <DialogTitle>Sample Library</DialogTitle>
        <DialogDescription>Open an editable copy of a sample, or add the whole collection to your browser library.</DialogDescription>
      </DialogHeader>
      {error ? <div role="alert" className="space-y-2 text-sm">
        <p>{error}</p>
        <Button variant="outline" onClick={() => setRetry(value => value + 1)}>Try again</Button>
      </div> : !library ? <p role="status" className="text-sm text-muted-foreground">Loading sample projects…</p> : <>
        <ul aria-label="Sample projects" className="min-h-0 flex-1 divide-y overflow-y-auto rounded-md border">
          {library.projects.map(project => <li key={project.id} className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{project.name}</p>
              <p className="text-xs text-muted-foreground">{project.doc.cutouts.length} pocket{project.doc.cutouts.length === 1 ? "" : "s"}</p>
            </div>
            <Button variant="outline" size="sm" className="min-h-11 shrink-0" disabled={busy}
              aria-label={`Open sample ${project.name}`} onClick={() => onOpenSample(project)}>Open</Button>
          </li>)}
        </ul>
        <p className="text-xs text-muted-foreground">Examples are starting points. Check dimensions and fit for your tools before printing.</p>
      </>}
      <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t pt-3">
        <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button className="h-auto min-h-11 whitespace-normal" disabled={!library || busy} onClick={() => { if (library) onImportAll(library); }}>
          Add {library ? `all ${library.projects.length} projects` : "all projects"} to Library
        </Button>
      </div>
    </DialogContent>
  </Dialog>;
}
