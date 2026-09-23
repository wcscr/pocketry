import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useExperimentalFeatures } from "@/state/experimental-features";

export function ExperimentalFeaturesDialog(): JSX.Element {
  const { enabled, setEnabled, settingsOpen, setSettingsOpen, persistenceUnavailable } = useExperimentalFeatures();
  return <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>Choose which tools appear in Pocketry.</DialogDescription>
      </DialogHeader>
      <div className="rounded-lg border p-4">
        <div className="flex min-h-11 items-center justify-between gap-4">
          <Label htmlFor="experimental-features" className="cursor-pointer text-sm font-medium">Enable experimental features</Label>
          <Switch id="experimental-features" checked={enabled} onCheckedChange={setEnabled} aria-describedby="experimental-features-description" />
        </div>
        <p id="experimental-features-description" className="mt-2 text-sm text-muted-foreground">
          Try pocket tilt, 3D move and rotate controls, multi-selection, alignment, distribution, and linked designs. These tools are still being refined.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">Off by default. Saved for this browser. Turning it off hides the tools; existing designs still load and export with their geometry and links intact.</p>
      </div>
      {persistenceUnavailable && <p role="status" className="text-sm text-muted-foreground">This preference applies for this tab only because browser storage is unavailable.</p>}
    </DialogContent>
  </Dialog>;
}
