import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { folderRequestId, type BrowserLibraryFolder } from "@/lib/project/browser-folder";
import type { FolderLibrary, OpenFolderProject } from "@/hooks/use-folder-library";
import type { ProjectDoc } from "@shared/gridfinity/project";

type Project = { projectId: string; revision: string; name: string };

interface Props {
  library: FolderLibrary;
  active: OpenFolderProject | null;
  busy: boolean;
  hasDraft: boolean;
  onOpen: (doc: ProjectDoc, target: OpenFolderProject) => Promise<void>;
  onOpened: () => void;
  onFolderChanged?: (folder: BrowserLibraryFolder | null) => Promise<void>;
  onSave: () => void;
  onExportDraft: () => void;
}

export function FolderLibraryContent({ library, active, busy, hasDraft, onOpen, onOpened, onFolderChanged, onSave, onExportDraft }: Props) {
  const [selection, setSelection] = useState<(Project & { action: "open" | "rename" | "remove" }) | null>(null);
  const [name, setName] = useState("");
  const disabled = busy || library.busy;
  const blockedWrite = disabled || library.pending.length > 0;

  const finish = async () => {
    if (!selection) return;
    const { action, projectId, revision } = selection;
    const completed = action === "open" ? await library.openProject(projectId, revision, onOpen)
      : await library.changeProject(projectId, revision, action === "rename" ? { kind: action, name } : { kind: action });
    if (completed) {
      setSelection(null);
      if (action === "open") onOpened();
    }
  };

  return <div className="space-y-3 px-0.5">
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <FolderOpen className="h-4 w-4 shrink-0" aria-hidden />
        <p className="min-w-0 break-words text-sm font-medium">{library.folder ? library.folder.name : "Save to a folder on your device"}</p>
      </div>
      <p className="text-xs text-muted-foreground">{library.folder
        ? "Use Save project to write changes to this folder. Drafts are recovered from this browser."
        : "Choose a folder to keep named projects on your device, even if you clear browser data."}</p>
      <div className="flex flex-wrap gap-2">
        {!library.canWrite && library.folder && <Button size="sm" className="min-h-11" disabled={disabled} onClick={() => void library.renew()}>Restore folder access</Button>}
        <Button size="sm" variant={library.folder ? "outline" : "default"} className="min-h-11" disabled={disabled || !library.supported}
          onClick={() => {
            setSelection(null);
            void library.connect().then(selected => { if (selected) return onFolderChanged?.(selected); });
          }}>
          {library.folder ? library.canWrite ? "Change folder" : "Choose folder again" : "Choose a folder"}
        </Button>
        {library.folder && <Button size="sm" variant="ghost" className="min-h-11" disabled={disabled}
          onClick={() => {
            setSelection(null);
            void library.disconnect().then(disconnected => { if (disconnected) return onFolderChanged?.(null); });
          }}>Disconnect</Button>}
        {library.canWrite && <Button size="sm" variant="ghost" className="min-h-11" disabled={disabled}
          onClick={() => { setSelection(null); void library.refresh(); }}>Refresh</Button>}
      </div>
      {!library.supported && <p className="text-sm">This browser can use Browser storage. Open Pocketry in desktop Chrome or Edge to connect a folder.</p>}
    </div>
    {library.error && <p role="alert" className="break-words text-sm text-destructive">{library.error}</p>}
    {library.message && <p role="status" className="break-words text-sm">{library.message}</p>}
    {library.canWrite && <>
      {library.pending.map(intent => <div className="space-y-2 rounded-md border p-3 text-sm" key={folderRequestId(intent)}>
        <p className="break-all">Check pending request {folderRequestId(intent)}</p>
        <Button size="sm" variant="outline" className="min-h-11" disabled={disabled} onClick={() => void library.resume(intent)}>Check and resume</Button>
      </div>)}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="min-h-11" disabled={blockedWrite} onClick={onSave}>Save current project</Button>
        <Button size="sm" variant="outline" className="min-h-11" disabled={blockedWrite} onClick={() => void library.copyBrowserProjects()}>Copy browser projects</Button>
      </div>
      {library.projects.length === 0 && <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">No projects in this folder yet.</p>}
      <ul className="space-y-2" aria-label="Projects in local folder">
        {library.projects.map(project => <li key={project.projectId} className="space-y-2 rounded-md border p-3">
          {project.conflicted && <p className="text-sm font-medium">Competing revisions</p>}
          {project.heads.filter(head => !head.deleted).map(head => {
            const current = active?.projectId === project.projectId && active.revision === head.revision;
            const target = { projectId: project.projectId, ...head };
            const selected = selection?.projectId === project.projectId && selection.revision === head.revision;
            return <div key={head.revision} className="space-y-2">
              <p className="break-words text-sm font-medium">{head.name}
                {project.conflicted && <small className="ml-1 text-muted-foreground">{head.revision.slice(0, 12)}</small>}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" className="min-h-11" disabled={disabled || current} aria-label={current ? `${head.name} is currently open` : `Open ${head.name}`}
                  onClick={() => {
                    if (hasDraft) setSelection({ ...target, action: "open" });
                    else void library.openProject(project.projectId, head.revision, onOpen).then(opened => { if (opened) onOpened(); });
                  }}>{current ? "Current" : "Open"}</Button>
                {!project.conflicted && <>
                  <Button size="sm" variant="outline" className="min-h-11" disabled={blockedWrite || current}
                    aria-label={`Rename ${head.name}`} onClick={() => { setName(head.name); setSelection({ ...target, action: "rename" }); }}>Rename</Button>
                  <Button size="sm" variant="outline" className="min-h-11" disabled={blockedWrite}
                    aria-label={`Copy ${head.name}`} onClick={() => void library.changeProject(project.projectId, head.revision, { kind: "copy" })}>Copy</Button>
                  <Button size="sm" variant="ghost" className="min-h-11 text-destructive" disabled={blockedWrite || active?.projectId === project.projectId}
                    aria-label={`Remove ${head.name}`} onClick={() => setSelection({ ...target, action: "remove" })}>Remove</Button>
                </>}
                {project.heads.length > 1 && <Button size="sm" variant="outline" className="min-h-11" disabled={blockedWrite}
                  onClick={() => void library.keepBoth(project, head.revision)}>Keep this as original</Button>}
              </div>
              {selected && <div className="space-y-2 rounded-md bg-muted p-3">
                {selection.action === "rename" ? <>
                  <Label htmlFor="folder-rename-project">New project name</Label>
                  <Input id="folder-rename-project" value={name} maxLength={80} onChange={event => setName(event.target.value)} />
                </> : <p className="text-sm">{selection.action === "open"
                  ? `Open “${head.name}” and replace the current working draft?`
                  : `Remove “${head.name}” from the folder library?`}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="min-h-11" disabled={disabled} onClick={() => setSelection(null)}>Cancel</Button>
                  {selection.action === "open" && <Button size="sm" variant="outline" className="min-h-11" disabled={disabled} onClick={onExportDraft}>Export current draft</Button>}
                  <Button size="sm" className="min-h-11" variant={selection.action === "remove" ? "destructive" : "default"}
                    disabled={disabled || (selection.action === "rename" && !name.trim())} onClick={() => void finish()}>
                    {selection.action === "open" ? "Open this revision" : selection.action === "remove" ? "Remove project" : "Save name"}
                  </Button>
                </div>
              </div>}
            </div>;
          })}
        </li>)}
      </ul>
    </>}
  </div>;
}
