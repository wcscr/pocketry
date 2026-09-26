import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { EDITOR_LAYOUTS, useExperimentalFeatures } from "@/state/experimental-features";

export function ExperimentalFeaturesDialog(): JSX.Element {
  const { enabled, setEnabled, editorLayout, setEditorLayout, settingsOpen, setSettingsOpen, persistenceUnavailable } = useExperimentalFeatures();
  return <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>Choose which tools appear in Pocketry.</DialogDescription>
      </DialogHeader>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold">Bin editor layout</legend>
        {EDITOR_LAYOUTS.map(layout => <label key={layout.value} className="flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
          <input type="radio" name="editor-layout" value={layout.value} checked={editorLayout === layout.value} onChange={() => setEditorLayout(layout.value)} className="mt-1 h-4 w-4 shrink-0 accent-primary" />
          <span><span className="block text-sm font-medium">{layout.label}</span><span className="mt-1 block text-xs text-muted-foreground">{layout.description}</span></span>
        </label>)}
        <p className="text-xs text-muted-foreground">Saved for this browser across page changes and refreshes.</p>
      </fieldset>
      <div className="rounded-lg border p-4">
        <div className="flex min-h-11 items-center justify-between gap-4">
          <Label htmlFor="experimental-features" className="cursor-pointer text-sm font-medium">Enable experimental features</Label>
          <Switch id="experimental-features" checked={enabled} onCheckedChange={setEnabled} aria-describedby="experimental-features-description" />
        </div>
        <p id="experimental-features-description" className="mt-2 text-sm text-muted-foreground">
          Try pocket tilt, 3D move and rotate controls, multi-selection, alignment, distribution, and linked designs. These tools are still being refined.
        </p>
        {enabled && <p id="experimental-layout-recommendation" className="mt-3 rounded-md bg-primary/5 p-3 text-sm">
          For experimental tools, we recommend <strong>Workflow left, properties right</strong> for its dedicated toolbar and properties panel.
        </p>}
        <p className="mt-3 text-xs text-muted-foreground">Off by default. Loading a project that uses experimental features enables them and shows a notification. Saved for this browser; turning it off hides the tools without changing existing designs or links.</p>
      </div>
      {persistenceUnavailable && <p role="status" className="text-sm text-muted-foreground">This preference applies for this tab only because browser storage is unavailable.</p>}
    </DialogContent>
  </Dialog>;
}
