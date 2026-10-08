import { useState, useSyncExternalStore } from "react";
import { FolderOpen, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { getFolderStatus, subscribeFolderStatus, supportsLibraryFolder } from "@/lib/project/folder-library";

export function useLibraryFolderStatus() {
  return useSyncExternalStore(subscribeFolderStatus, getFolderStatus, getFolderStatus);
}

export interface LibraryFolderControlsProps {
  busy: boolean;
  onConnect(copyBrowser: boolean): void;
  onReconnect(): void;
  onKeepBoth(): void;
  onDisconnect(): void;
  onExportProject(): void;
}

/** Location and recovery controls remain in the existing library manager. */
export function LibraryFolderControls({ busy, onConnect, onReconnect, onKeepBoth, onDisconnect, onExportProject }: LibraryFolderControlsProps) {
  const status = useLibraryFolderStatus();
  const [copyBrowser, setCopyBrowser] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const connected = status.folderName !== null;
  const failed = ["permission-required", "conflict", "error"].includes(status.state);
  return <Collapsible open={expanded || failed} onOpenChange={setExpanded} asChild>
    <section aria-label="Library storage" className="shrink-0 rounded-md border text-xs">
    <CollapsibleTrigger asChild>
      <Button variant="ghost" disabled={failed} className="h-auto min-h-9 w-full justify-between gap-2 px-2 py-2 text-xs [@media(pointer:coarse)]:min-h-11">
        <span className="truncate">{connected ? `Storage: ${status.folderName}` : "Storage: this browser"}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 ${expanded || failed ? "rotate-180" : ""}`} />
      </Button>
    </CollapsibleTrigger>
    <CollapsibleContent className="space-y-2 px-3 pb-3">
    <p className="font-medium break-words">{connected ? `Folder: ${status.folderName}/pocketry-library` : "Library storage: this browser"}</p>
    <p role="status" className="text-muted-foreground break-words">
      {status.message ?? (connected ? status.state === "saving" ? "Saving to folder…" : "Folder connected. Completed saves remain on your computer after browser data is cleared."
        : "Connect a folder to save named projects on your computer and open them in another supported browser.")}
    </p>
    {!connected && (supportsLibraryFolder() ? <>
      <label className="flex items-start gap-2">
        <Checkbox checked={copyBrowser} disabled={busy} onCheckedChange={value => setCopyBrowser(value === true)} />
        Copy browser library into the folder; keep originals and both versions of conflicting projects.
      </label>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => onConnect(copyBrowser)} className="gap-1.5">
        <FolderOpen className="h-4 w-4" />Connect library folder
      </Button>
    </> : <p className="text-muted-foreground">Direct folder access requires a supported browser such as desktop Chrome or Edge. You can still save here and export/import library backups below.</p>)}
    {connected && <div className="flex flex-wrap gap-2">
      {(status.state === "permission-required" || status.state === "error") && <Button size="sm" variant="outline" disabled={busy} onClick={onReconnect}>Reconnect folder</Button>}
      {status.state === "conflict" && <Button size="sm" variant="outline" disabled={busy} onClick={onKeepBoth}>Keep both versions</Button>}
      {failed && <Button size="sm" variant="outline" disabled={busy} onClick={onExportProject}>Export current project</Button>}
      <Button size="sm" variant="ghost" disabled={busy} onClick={onDisconnect} className="gap-1.5"><Unplug className="h-4 w-4" />Disconnect folder</Button>
    </div>}
    {connected && <p className="text-muted-foreground">Named projects autosave here; unnamed drafts stay in this browser. Earlier folder revisions are retained for recovery. Disconnecting keeps your files and returns the open design to a browser draft.</p>}
    {status.state === "conflict" && <p className="text-muted-foreground">Keep both versions retains the folder versions and your open design, then leaves your design open as a draft. Open the version you want to continue editing.</p>}
    </CollapsibleContent>
  </section></Collapsible>;
}
