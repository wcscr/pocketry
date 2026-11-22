import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrowserLibraryFolder, folderRequestId, type FolderIntent } from "@/lib/project/browser-folder";
import { exportProjectLibrary } from "@/lib/project/persist";
import { ConnectedLibrary, type FolderProject } from "@shared/project-library/library";
import { assignedProjectId, FOLDER_LIMITS, LibraryError, projectNameSchema, readFolderProject } from "@shared/project-library/format";
import type { ProjectDoc } from "@shared/gridfinity/project";

export interface OpenFolderProject {
  folder: BrowserLibraryFolder;
  projectId: string;
  revision: string;
  name: string;
}

interface Props {
  disabled: boolean;
  doc: ProjectDoc;
  active: OpenFolderProject | null;
  onOpen: (doc: ProjectDoc, target: OpenFolderProject) => Promise<void>;
  onTargetChange: (target: OpenFolderProject | null) => void;
}

export function ConnectedFolderDialog({ disabled, doc, active, onOpen, onTargetChange }: Props) {
  const [open, setOpen] = useState(false);
  const [folder, setFolder] = useState<BrowserLibraryFolder | null>(null);
  const [projects, setProjects] = useState<FolderProject[]>([]);
  const [pending, setPending] = useState<FolderIntent[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<{ projectId: string; revision: string; name: string } | null>(null);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try { await operation(); }
    catch (cause) {
      if (cause instanceof LibraryError && cause.code === "permission") setCanWrite(false);
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : "The folder operation failed.");
      }
    } finally { setBusy(false); }
  };

  const load = async (selected: BrowserLibraryFolder | null) => {
    setCanWrite(false);
    setFolder(selected);
    setSelection(null);
    setProjects([]);
    setPending([]);
    const allowed = await selected?.canWrite() ?? false;
    setCanWrite(allowed);
    if (allowed && selected) {
      setPending(await selected.pending());
      setProjects(await new ConnectedLibrary(selected).list());
    }
  };

  const apply = async (selected: BrowserLibraryFolder, intent: FolderIntent) => {
    const service = new ConnectedLibrary(selected);
    const requestId = folderRequestId(intent);
    await selected.remember(intent);
    let outcome;
    try {
      const observed = intent.candidateRevision ? await service.inspect(requestId, intent.candidateRevision) : null;
      if (observed?.status === "published-unverified" ||
          (observed && "publications" in observed && observed.publications.some(item => item.revision === intent.candidateRevision))) {
        outcome = observed;
      } else {
        outcome = intent.kind === "commit" ? await service.commit(intent.mutation)
          : await service.keepBoth(requestId, intent.projectId, intent.expected, intent.keep);
      }
    } catch (cause) {
      if (cause instanceof LibraryError && ["stale-base", "conflict", "validation", "resource-limit", "request-reused"].includes(cause.code)) {
        await selected.forget(requestId).catch(() => {});
      }
      // A permission change must keep the selected directory available for renewal.
      if (!await selected.canWrite()) setCanWrite(false);
      throw cause;
    } finally {
      setPending(await selected.pending().catch(() => []));
    }
    if ("publications" in outcome) {
      const [published] = outcome.publications;
      const change = intent.kind === "commit" && intent.mutation.changes.length === 1 ? intent.mutation.changes[0] : null;
      if (change?.doc && outcome.status === "published") {
        onTargetChange({ folder: selected, projectId: change.projectId, revision: published.revision, name: change.name });
      }
      setMessage(outcome.status === "published"
        ? `Saved revision ${published.revision.slice(0, 12)}.`
        : "The revision was published. The folder also contains competing work. Review the versions below.");
      // The file is authoritative even when local journal cleanup fails.
      await selected.forget(requestId).catch(() => {});
    } else if ("revision" in outcome) {
      await selected.remember({ ...intent, candidateRevision: outcome.revision }).catch(() => {});
      if (outcome.status === "published-unverified") {
        setMessage(`Revision ${outcome.revision} was written. Check request ${requestId} to verify the current folder heads.`);
      } else {
        setError(`The write outcome is uncertain. Check request ${requestId} and revision ${outcome.revision} before starting another save.`);
      }
    }
    setPending(await selected.pending().catch(() => []));
    setProjects(await service.list().catch(() => projects));
  };

  const save = async (replace: boolean) => {
    if (!folder) return;
    const requestId = crypto.randomUUID();
    const projectName = projectNameSchema.safeParse(name.trim().replace(/\s+/g, " "));
    if (!projectName.success) throw new LibraryError("validation", "Enter a project name up to 80 characters.");
    const target = replace && active && await folder.sameDirectory(active.folder) ? active : null;
    if (replace && !target) throw new LibraryError("stale-base", "Reopen the project from this folder before updating it.");
    await apply(folder, { kind: "commit", mutation: { requestId, changes: [{
      projectId: target?.projectId ?? await assignedProjectId(requestId),
      parents: target ? [target.revision] : [],
      name: projectName.data,
      doc,
    }] } });
  };

  const copyBrowserLibrary = async () => {
    if (!folder) return;
    const service = new ConnectedLibrary(folder);
    const backup = await exportProjectLibrary();
    const existing = new Set((await service.list()).map(project => project.projectId));
    const changes = backup.projects.flatMap(project => {
      if (existing.has(project.id)) return [];
      try {
        return [{ projectId: project.id, name: project.name, doc: readFolderProject(project.doc), parents: [] }];
      } catch (error) {
        if (!(error instanceof LibraryError)) throw error;
        return [];
      }
    });
    if (changes.length > FOLDER_LIMITS.changes) {
      throw new LibraryError("resource-limit", `Copy up to ${FOLDER_LIMITS.changes} projects at once. Open and save individual projects for larger libraries.`);
    }
    if (changes.length) {
      await apply(folder, { kind: "commit", mutation: { requestId: crypto.randomUUID(), changes } });
      if (backup.projects.length > changes.length) {
        setMessage(current => `${current} Already copied or unreadable projects were skipped.`);
      }
    } else setMessage("No new readable browser projects to copy.");
  };

  const choose = async () => {
    const selected = await BrowserLibraryFolder.choose();
    if (active && !await selected.sameDirectory(active.folder)) onTargetChange(null);
    await load(selected);
  };

  const reopen = async () => {
    if (!selection || !folder) return;
    const value = await new ConnectedLibrary(folder).read(selection.projectId, selection.revision);
    await onOpen(value.doc, { folder, projectId: selection.projectId, revision: value.revision, name: value.name });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={value => {
      if (busy) return;
      setOpen(value);
      if (value) {
        setName(active?.name ?? doc.name ?? "");
        void run(async () => load(await BrowserLibraryFolder.saved()));
      }
    }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} className="min-h-11 w-full gap-1.5">
          <FolderOpen className="h-3.5 w-3.5" />Connected folder
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Connected project folder</DialogTitle>
          <DialogDescription>Save a named revision to a local folder. Editor autosaves stay in this browser.</DialogDescription>
        </DialogHeader>
        {folder && <p className="break-all text-sm font-medium">{folder.name}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy || !BrowserLibraryFolder.supported()} onClick={() => void run(choose)}>
            {folder ? canWrite ? "Choose another folder" : "Choose folder again" : "Connect folder"}
          </Button>
          {folder && <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
            await BrowserLibraryFolder.disconnect();
            onTargetChange(null);
            await load(null);
          })}>Disconnect</Button>}
          {folder && !canWrite && <Button disabled={busy} onClick={() => void run(async () => {
            if (!await folder.renew()) throw new LibraryError("permission", "Folder access was not granted. Allow file editing in the browser’s site settings, or choose the folder again.");
            await load(folder);
          })}>Renew access</Button>}
          {folder && canWrite && <Button variant="outline" disabled={busy} onClick={() => void run(() => load(folder))}>Refresh</Button>}
        </div>
        {!folder && !BrowserLibraryFolder.supported() && <p className="text-sm">Use a supported desktop browser over HTTPS or localhost to connect a folder. The browser library is available here.</p>}
        {error && <p role="alert" className="break-all text-sm text-destructive">{error}</p>}
        {message && <p role="status" className="text-sm">{message}</p>}
        {folder && canWrite && <>
          {pending.map(intent => <div className="space-y-2 rounded-md border p-3 text-sm" key={folderRequestId(intent)}>
            <p className="break-all">Check pending request {folderRequestId(intent)}</p>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => apply(folder, intent))}>Check and resume</Button>
          </div>)}
          <div className="space-y-2">
            <Label htmlFor="folder-project-name">Project name</Label>
            <Input id="folder-project-name" value={name} maxLength={80} onChange={event => setName(event.target.value)} />
            <div className="flex flex-wrap gap-2">
              {active && <Button disabled={busy || pending.length > 0 || !name.trim()} onClick={() => void run(() => save(true))}>Save folder revision</Button>}
              <Button variant={active ? "outline" : "default"} disabled={busy || pending.length > 0 || !name.trim()} onClick={() => void run(() => save(false))}>Save as new folder project</Button>
            </div>
          </div>
          <Button variant="outline" disabled={busy || pending.length > 0} onClick={() => void run(copyBrowserLibrary)}>Copy saved browser projects</Button>
          <ul className="space-y-2">
            {projects.map(project => <li key={project.projectId} className="space-y-2 rounded-md border p-3">
              {project.conflicted && <p className="text-sm font-medium">Competing revisions</p>}
              {project.heads.filter(head => !head.deleted).map(head => (
                <div className="flex flex-wrap items-center gap-2" key={head.revision}>
                  <span className="min-w-0 flex-1 break-words text-sm">{head.name}
                    {project.conflicted && <small className="ml-1 text-muted-foreground">{head.revision.slice(0, 12)}</small>}
                  </span>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setSelection({ projectId: project.projectId, ...head })}>Open</Button>
                  {project.heads.length > 1 && <Button size="sm" variant="outline" disabled={busy || pending.length > 0} onClick={() => void run(() => apply(folder, {
                    kind: "keep-both", requestId: crypto.randomUUID(), projectId: project.projectId,
                    expected: project.heads.map(candidate => candidate.revision), keep: head.revision,
                  }))}>Keep this as original</Button>}
                </div>
              ))}
            </li>)}
          </ul>
          {selection && <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm">Open “{selection.name}” in the editor? Save or download any draft you want to keep first.</p>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setSelection(null)}>Cancel</Button>{" "}
            <Button size="sm" disabled={busy} onClick={() => void run(reopen)}>Open this revision</Button>
          </div>}
        </>}
      </DialogContent>
    </Dialog>
  );
}
