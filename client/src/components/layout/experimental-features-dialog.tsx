import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useExperimentalFeatures } from "@/state/experimental-features";

export function ExperimentalFeaturesDialog(): JSX.Element {
  const { enabled, setEnabled, inspectorEnabled, setInspectorEnabled, settingsOpen, setSettingsOpen, persistenceUnavailable } = useExperimentalFeatures();
  return <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>Choose which tools appear in Pocketry.</DialogDescription>
      </DialogHeader>
      <div className="rounded-lg border p-4">
        <div className="flex min-h-11 items-center justify-between gap-4">
          <Label htmlFor="selection-inspector" className="cursor-pointer text-sm font-medium">Show properties on the right</Label>
          <Switch id="selection-inspector" checked={inspectorEnabled} onCheckedChange={setInspectorEnabled} aria-describedby="selection-inspector-description" />
        </div>
        <p id="selection-inspector-description" className="mt-2 text-sm text-muted-foreground">
          Try the new bin layout with objects and properties in a separate pane, including move, rotate, and arrangement tools. Saved for this browser across page changes and refreshes.
        </p>
      </div>
      <div className="rounded-lg border p-4">
        <div className="flex min-h-11 items-center justify-between gap-4">
          <Label htmlFor="experimental-features" className="cursor-pointer text-sm font-medium">Enable experimental features</Label>
          <Switch id="experimental-features" checked={enabled} onCheckedChange={setEnabled} aria-describedby="experimental-features-description" />
        </div>
        <p id="experimental-features-description" className="mt-2 text-sm text-muted-foreground">
          Try pocket tilt, 3D move and rotate controls, multi-selection, alignment, distribution, and linked designs. These tools are still being refined.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">Off by default. Loading a project that uses experimental features enables them and shows a notification. Saved for this browser; turning it off hides the tools without changing existing designs or links.</p>
      </div>
      {persistenceUnavailable && <p role="status" className="text-sm text-muted-foreground">This preference applies for this tab only because browser storage is unavailable.</p>}
    </DialogContent>
  </Dialog>;
}
