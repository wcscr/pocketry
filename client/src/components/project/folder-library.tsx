import { useState } from "react";
import { Check } from "lucide-react";
import { LibraryProjectAction } from "@/components/project/library-project-action";
import { Button } from "@/components/ui/button";
import { HelpHint } from "@/components/ui/help-hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { folderRequestId, type FolderDraft, type FolderIntent } from "@/lib/project/browser-folder";
import type { FolderLibrary } from "@/hooks/use-folder-library";
import type { ProjectDoc } from "@shared/gridfinity/project";

type Project = { projectId: string; revision: string; name: string };

interface Props {
  library: FolderLibrary;
  active: FolderDraft | null;
  busy: boolean;
  hasDraft: boolean;
  onOpen: (doc: ProjectDoc, target: FolderDraft) => Promise<void>;
  onOpened: () => void;
  onSave: () => void;
  onResume: (intent: FolderIntent) => Promise<void>;
  onExportDraft: () => void;
  onExportCompact: (doc: ProjectDoc, name: string) => void;
}

export function FolderLibraryContent({ library, active, busy, hasDraft, onOpen, onOpened, onSave, onResume, onExportDraft, onExportCompact }: Props) {
  const [selection, setSelection] = useState<(Project & { action: "open" | "rename" | "remove" }) | null>(null);
  const [name, setName] = useState("");
  const disabled = busy || library.busy;
  const blockedWrite = disabled || library.pending.length > 0;
  const currentProject = active?.connectionId === library.folder?.id ? active : null;
  const finish = async () => {
    if (!selection) return;
    const { action, projectId, revision } = selection;
    const completed = action === "open" ? await library.withProject(projectId, revision, onOpen)
      : await library.changeProject(projectId, revision, action === "rename" ? { kind: action, name } : { kind: action });
    if (completed) {
      setSelection(null);
      if (action === "open") onOpened();
    }
  };

  return <div className="space-y-3 px-0.5">
    {library.canRecoverLegacy && <FolderRecovery disabled={blockedWrite || !library.canWrite} onRecover={() => void library.recoverLegacy()} />}
    {!library.canWrite && <div className="space-y-2 rounded-md border border-dashed p-4">
      <p className="text-sm text-muted-foreground" role="status">
        {library.busy ? "Checking folder access…" : library.folder ? "Folder access needed" : library.supported ? "No folder connected" : "Local folders unavailable"}
      </p>
      {library.supported && <div className="flex flex-wrap gap-2">
        {library.folder && <Button size="sm" className="min-h-11" disabled={disabled} onClick={() => void library.renew()}>Restore folder access</Button>}
        <Button size="sm" variant={library.folder ? "outline" : "default"} className="min-h-11" disabled={disabled} onClick={() => void library.connect()}>
          {library.folder ? "Choose folder again" : "Choose a folder"}
        </Button>
      </div>}
    </div>}
    <FolderFeedback library={library} />
    {library.canWrite && !library.legacyFolder && <>
      {library.pending.map(intent => <div className="space-y-2 rounded-md border p-3 text-sm" key={folderRequestId(intent)}>
        <p className="break-all">Check pending request {folderRequestId(intent)}</p>
        <Button size="sm" variant="outline" className="min-h-11" disabled={disabled} onClick={() => void onResume(intent)}>Check and resume</Button>
      </div>)}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="min-h-11" data-testid="button-save-folder-project" disabled={blockedWrite} onClick={onSave}>Save current project</Button>
      </div>
      {library.projects.length === 0 && <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">No projects in this folder yet.</p>}
      <ul className="space-y-1.5 pr-2" aria-label="Projects in local folder">
        {library.projects.map(project => <li key={project.projectId} className="space-y-1.5 rounded-md border px-2 py-1">
          {project.conflicted && <p className="text-sm font-medium">Competing revisions</p>}
          {project.heads.filter(head => !head.deleted).map(head => {
            const current = currentProject?.projectId === project.projectId && currentProject.revision === head.revision;
            const target = { projectId: project.projectId, ...head };
            const selected = selection?.projectId === project.projectId && selection.revision === head.revision;
            return <div key={head.revision} className="space-y-2">
              <div className="flex min-w-0 items-center gap-1.5 max-[380px]:flex-wrap">
                <div className="min-w-0 flex-1 max-[380px]:basis-full">
                  <p className="truncate text-sm font-medium [@media(pointer:coarse)]:line-clamp-2 [@media(pointer:coarse)]:whitespace-normal [@media(pointer:coarse)]:break-words" title={head.name}>{head.name}</p>
                  {project.conflicted && <p className="text-xs text-muted-foreground">{head.revision.slice(0, 12)}</p>}
                </div>
                <div className="flex shrink-0 items-center">
                  <LibraryProjectAction action="open" icon={current ? Check : undefined} disabled={disabled || current}
                    label={current ? `${head.name} is currently open` : `Open ${head.name}`}
                    onClick={() => {
                      if (hasDraft) setSelection({ ...target, action: "open" });
                      else void library.withProject(project.projectId, head.revision, onOpen).then(opened => { if (opened) onOpened(); });
                    }} />
                  {!project.conflicted && <LibraryProjectAction action="copy" disabled={blockedWrite}
                    label={`Copy ${head.name}`} onClick={() => void library.changeProject(project.projectId, head.revision, { kind: "copy" })} />}
                  <LibraryProjectAction action="compact" disabled={disabled} label={`Export compact copy of ${head.name}`}
                    onClick={() => void library.withProject(project.projectId, head.revision, (doc, target) => onExportCompact(doc, target.name))} />
                  {!project.conflicted && <>
                    <LibraryProjectAction action="rename" disabled={blockedWrite || current}
                      label={`Rename ${head.name}`} onClick={() => { setName(head.name); setSelection({ ...target, action: "rename" }); }} />
                    <LibraryProjectAction action="remove" disabled={blockedWrite || currentProject?.projectId === project.projectId}
                      label={`Remove ${head.name}`} onClick={() => setSelection({ ...target, action: "remove" })} />
                  </>}
                </div>
              </div>
              {project.heads.length > 1 && <Button size="sm" variant="outline" className="min-h-11" disabled={blockedWrite}
                onClick={() => void library.keepBoth(project, head.revision)}>Keep this as original</Button>}
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

function FolderFeedback({ library }: { library: FolderLibrary }) {
  return <>
    {library.error && <p role="alert" className="break-words text-sm text-destructive">{library.error}</p>}
    {library.message && <p role="status" className="break-words text-sm">{library.message}</p>}
  </>;
}

function FolderRecovery({ disabled, onRecover }: { disabled: boolean; onRecover: () => void }) {
  return <div className="space-y-2 rounded-md border p-3">
    <p className="text-sm font-medium">Older Pocketry library</p>
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" className="min-h-11" disabled={disabled} onClick={onRecover}>Recover projects</Button>
      <HelpHint label="recovering older projects">Recover the saved projects into this local folder. Pocketry keeps the original files and opens the recovered library when it’s ready.</HelpHint>
    </div>
  </div>;
}

export function FolderLibrarySettings({ library, busy, onRecover }: { library: FolderLibrary; busy: boolean; onRecover: () => void }) {
  const disabled = busy || library.busy;
  return <div className="space-y-3">
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center gap-1.5">
        <p className="min-w-0 break-words text-sm font-medium">{library.folder?.name ?? (library.supported ? "No folder connected" : "Local folders unavailable")}</p>
        <HelpHint label="folder setup">{library.supported
          ? "Pocketry creates a pocketry-library folder inside the one you choose. Saved projects stay there if you clear browser data."
          : "Use Browser storage here, or open Pocketry in desktop Chrome or Edge to connect a folder."}</HelpHint>
      </div>
      <div className="flex flex-wrap gap-2">
        {library.folder && !library.canWrite && <Button size="sm" className="min-h-11" disabled={disabled} onClick={() => void library.renew()}>Restore folder access</Button>}
        {library.supported && <Button size="sm" variant={library.folder ? "outline" : "default"} className="min-h-11" disabled={disabled} onClick={() => void library.connect()}>
          {library.folder ? library.canWrite ? "Change folder" : "Choose folder again" : "Choose a folder"}
        </Button>}
        {library.canWrite && <Button size="sm" variant="outline" className="min-h-11" disabled={disabled}
          onClick={() => void library.refresh()}>Refresh project list</Button>}
        {library.folder && <Button size="sm" variant="ghost" className="min-h-11" disabled={disabled}
          onClick={() => void library.disconnect()}>Disconnect folder</Button>}
      </div>
    </div>
    {library.canRecoverLegacy && <FolderRecovery disabled={disabled || !library.canWrite || library.pending.length > 0} onRecover={onRecover} />}
    {library.canWrite && !library.legacyFolder && <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant="outline" className="min-h-11" disabled={disabled || library.pending.length > 0}
        onClick={() => void library.copyBrowserProjects()}>Copy browser projects</Button>
      <HelpHint label="copying browser projects">Copy the named projects saved in this browser into the connected folder. You can still open the originals from Browser storage.</HelpHint>
    </div>}
    <FolderFeedback library={library} />
  </div>;
}
