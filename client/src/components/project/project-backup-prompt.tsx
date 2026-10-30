import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ProjectBackupPromptProps {
  open: boolean;
  busy: boolean;
  targetName: string;
  replacesProject: boolean;
  hasProject: boolean;
  hasLibrary: boolean;
  currentProjectName: string | null;
  onCancel: () => void;
  onContinue: () => void;
  onSave: (name: string) => Promise<boolean>;
  onExportProject: () => void;
  onExportLibrary: () => void;
}

/** Backups never navigate: the user explicitly continues after saving/exporting. */
export function ProjectBackupPrompt({ open, busy, targetName, replacesProject, hasProject, hasLibrary, currentProjectName, onCancel, onContinue, onSave, onExportProject, onExportLibrary }: ProjectBackupPromptProps) {
  const [name, setName] = useState("");
  const [result, setResult] = useState<"saved" | "error" | null>(null);
  const [saving, setSaving] = useState(false);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) { setName(currentProjectName ?? ""); setResult(null); }
    wasOpen.current = open;
  }, [open, currentProjectName]);
  const working = busy || saving;
  return <Dialog open={open} onOpenChange={next => { if (!next && !working) onCancel(); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Save or export before continuing?</DialogTitle>
        <DialogDescription>
          {replacesProject ? `Opening “${targetName}” will switch away from your current project.`
            : "The sample projects will be added alongside your saved projects. Your current project stays open."}
          {" "}Would you like to save your project or export a backup first?
        </DialogDescription>
      </DialogHeader>
      {hasProject && <form className="space-y-2" onSubmit={async event => {
        event.preventDefault();
        if (working || !name.trim()) return;
        setSaving(true);
        try { setResult(await onSave(name.trim()) ? "saved" : "error"); }
        catch { setResult("error"); }
        finally { setSaving(false); }
      }}>
        <Label htmlFor="sample-backup-project-name">Project name</Label>
        <Input id="sample-backup-project-name" autoComplete="off" value={name} maxLength={80} disabled={working} onChange={event => { setName(event.target.value); setResult(null); }} />
        <Button type="submit" variant="outline" disabled={working || !name.trim()} className="min-h-11 w-full">Save project to Library</Button>
        {result === "saved" && <p role="status" className="text-sm">Project saved. Continue when you are ready.</p>}
        {result === "error" && <p role="alert" className="text-sm text-destructive">Could not save. Export a backup or cancel to keep working.</p>}
      </form>}
      <div className="grid gap-2 sm:grid-cols-2">
        {hasProject && <Button variant="outline" className="min-h-11" disabled={working} onClick={onExportProject}>Export current project</Button>}
        {hasLibrary && <Button variant="outline" className="min-h-11" disabled={working} onClick={onExportLibrary}>Export existing library</Button>}
      </div>
      <p className="text-xs text-muted-foreground">Library exports include named projects. Save or export an unnamed draft separately.</p>
      <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
        <Button variant="outline" className="min-h-11" disabled={working} onClick={onCancel}>Cancel</Button>
        <Button className="min-h-11" disabled={working} onClick={onContinue}>{working ? "Working…" : replacesProject ? "Open sample" : "Add sample library"}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
