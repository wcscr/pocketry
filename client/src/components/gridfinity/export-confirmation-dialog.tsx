import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

/** Shared opt-in for downloading the editable design beside an exported file. */
export function ProjectBackupOption({ checked, onChange, description = "Keep a copy to reopen tools and settings later.", disabledReason }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  disabledReason?: string;
}): JSX.Element {
  const id = useId();
  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-3">
      <Checkbox id={id} checked={checked} disabled={Boolean(disabledReason)} onCheckedChange={(value) => onChange(value === true)} className="mt-0.5" data-testid="checkbox-export-project" />
      <div className="min-w-0 space-y-1">
        <Label htmlFor={id} className="cursor-pointer text-sm leading-snug">Also download editable project (.pocketry.json)</Label>
        <p className="text-xs text-muted-foreground">{disabledReason ?? description}</p>
      </div>
    </div>
  );
}

/** Mount for each export request so including a project is always an explicit choice. */
export function ExportConfirmationDialog({ title, description, confirmLabel = "Download", backupDescription, backupDisabledReason, onConfirm, onCancel }: {
  title: string;
  description: string;
  confirmLabel?: string;
  backupDescription?: string;
  backupDisabledReason?: string;
  onConfirm: (includeProject: boolean) => void;
  onCancel: () => void;
}): JSX.Element {
  const [includeProject, setIncludeProject] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] grid-cols-1 overflow-y-auto sm:max-w-md">
        <DialogHeader className="min-w-0 pr-6 text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ProjectBackupOption checked={includeProject} onChange={setIncludeProject} description={backupDescription} disabledReason={backupDisabledReason} />
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onConfirm(includeProject && !backupDisabledReason)} data-testid="button-confirm-export">{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
