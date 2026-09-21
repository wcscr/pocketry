import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CalibrationDownloads } from "@/components/trace/calibration-downloads";

export interface HelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The essential steps for making a first bin. */
export function HelpDialog({ open, onOpenChange }: HelpDialogProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>How to use Pocketry</DialogTitle>
          <DialogDescription>From a tool photo to your first bin.</DialogDescription>
        </DialogHeader>

        <ol className="list-decimal space-y-4 pl-5 text-sm leading-relaxed marker:font-semibold">
          <li className="pl-1">
            <h3 className="font-semibold">Choose a photo</h3>
            <p className="text-muted-foreground">
              In <strong>Trace</strong>, upload a clear photo taken from above.
              Use a contrasting background and include a known measurement at the
              tool’s height, or use a calibration template.
            </p>
            <CalibrationDownloads />
          </li>
          <li className="pl-1">
            <h3 className="font-semibold">Set the real size</h3>
            <p className="text-muted-foreground">
              Review and accept the detected scale. Or choose <strong>Set scale</strong>,
              mark two points a known distance apart, enter that distance in
              millimetres, and choose <strong>Confirm scale</strong>.
            </p>
          </li>
          <li className="pl-1">
            <h3 className="font-semibold">Trace the tool</h3>
            <p className="text-muted-foreground">
              Draw a <strong>Region</strong> around the tool. Adjust the outline
              if needed, then choose <strong>Add to bin</strong>.
            </p>
          </li>
          <li className="pl-1">
            <h3 className="font-semibold">Arrange the pockets</h3>
            <p className="text-muted-foreground">
              In <strong>Layout</strong>, drag pockets into place. Set
              <strong> Bin size</strong>, then select each pocket to set its
              <strong> Depth</strong>.
            </p>
            <p className="mt-1 text-muted-foreground">
              To store tall items in a shorter drawer, open the pocket’s
              <strong> Position &amp; rotation</strong> controls and set its X/Y tilt.
              Items slide out along the tilted axis. Fixed depth follows that axis;
              the opening expands to keep the path clear. Check the 3D preview
              and the remaining floor before printing.
            </p>
          </li>
          <li className="pl-1">
            <h3 className="font-semibold">Check the fit, then print</h3>
            <p className="text-muted-foreground">
              Print a <strong>Surface fit test</strong> from <strong>Check fit</strong>{" "}
              and try your tools. When the fit is right, choose <strong>Save 3MF</strong>{" "}
              under <strong>Export printable bin</strong> and open it in your slicer.
            </p>
          </li>
        </ol>

        <div className="space-y-2 border-t pt-3 text-sm text-muted-foreground">
          <p>
            <strong>Save for later:</strong> In <strong>Project</strong>, use
            <strong> Save to library</strong> to name your design.
            <strong> Export project</strong> downloads an editable backup;
            <strong> Open project</strong> restores it to this browser’s library.
          </p>
          <p>
            <strong>On a phone:</strong> use <strong>Adjust</strong> for quick changes,
            or <strong>More options → All settings</strong>.
          </p>
          <section aria-label="Feedback" className="flex flex-wrap gap-x-5 text-xs">
            <a className="inline-flex min-h-11 items-center text-primary underline underline-offset-4" href="https://github.com/wcscr/pocketry/issues/new" target="_blank" rel="noopener noreferrer">Report an issue on GitHub<span className="sr-only"> (opens a new tab)</span></a>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
