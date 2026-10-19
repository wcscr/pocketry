import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { EDITOR_LAYOUTS, useExperimentalFeatures } from "@/state/experimental-features";

export function ExperimentalFeaturesDialog(): JSX.Element {
  const { enabled, setEnabled, editorLayout, setEditorLayout, settingsOpen, setSettingsOpen, persistenceUnavailable } = useExperimentalFeatures();
  return <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
      <DialogHeader>
        <DialogTitle>App settings</DialogTitle>
        <DialogDescription>Choose your editor layout and optional tools.</DialogDescription>
      </DialogHeader>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold">Editor layout</legend>
        {EDITOR_LAYOUTS.map(layout => <label key={layout.value} className="flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
          <input type="radio" name="editor-layout" value={layout.value} checked={editorLayout === layout.value} onChange={() => setEditorLayout(layout.value)} className="mt-1 h-4 w-4 shrink-0 accent-primary" />
          <span><span className="block text-sm font-medium">{layout.label}</span><span className="mt-1 block text-xs text-muted-foreground">{layout.description}</span></span>
        </label>)}
      </fieldset>
      <div className="rounded-lg border p-4">
        <div className="flex min-h-11 items-center justify-between gap-4">
          <Label htmlFor="experimental-features" className="cursor-pointer text-sm font-medium">Enable experimental features</Label>
          <Switch id="experimental-features" checked={enabled} onCheckedChange={setEnabled} aria-describedby="experimental-features-description" />
        </div>
        <ul id="experimental-features-description" className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Slanted bin walls</li>
          <li>Wham Bam Ultim8 Jig fixtures for UV / laser jigs</li>
          <li>Adjustable walls for empty bins</li>
          <li>Linked pockets and finger access with shared size, shape, and depth</li>
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">Off by default. Saved designs remain visible and exportable.</p>
      </div>
      {persistenceUnavailable && <p role="status" className="text-sm text-muted-foreground">This preference applies for this tab only because browser storage is unavailable.</p>}
    </DialogContent>
  </Dialog>;
}
