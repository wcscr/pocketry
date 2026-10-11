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

/** The essential steps for making a first bin in the default editor. */
export function HelpDialog({ open, onOpenChange }: HelpDialogProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>How to use Pocketry</DialogTitle>
          <DialogDescription>From a tool photo to your first bin.</DialogDescription>
        </DialogHeader>

        <p className="text-sm leading-relaxed text-muted-foreground">
          On desktop, the default <strong>Workflow + properties</strong> layout
          has workflow steps on the left and their controls on the right. Choose
          a step or select an object to edit it. Smaller screens start with a
          single panel. Change or restore your layout in
          <strong> App settings → Editor layout</strong>; your choice is remembered.
        </p>

        <ol className="list-decimal space-y-4 pl-5 text-sm leading-relaxed marker:font-semibold">
          <li className="pl-1">
            <h3 className="font-semibold">Choose a photo</h3>
            <p className="text-muted-foreground">
              In <strong>Trace</strong>, choose a clear PNG or JPEG taken from
              above. Keep the whole tool visible against a contrasting background.
              Include a known measurement at the tool’s height, or use a
              calibration template with all four markers visible.
            </p>
            <CalibrationDownloads />
          </li>
          <li className="pl-1">
            <h3 className="font-semibold">Set the real size</h3>
            <p className="text-muted-foreground">
              In <strong>Scale</strong>, review the reference detection. For a
              calibration sheet, choose <strong>Correct perspective &amp; use scale</strong>;
              other detected references offer <strong>Accept detected scale</strong>.
              Or choose <strong>Set scale</strong>,
              mark two points a known distance apart, enter that distance in
              millimetres, and choose <strong>Confirm scale</strong>.
            </p>
          </li>
          <li className="pl-1">
            <h3 className="font-semibold">Trace the tool</h3>
            <p className="text-muted-foreground">
              Choose <strong>Region → Set region</strong> and draw a box around
              the tool. If perspective correction crops the tool, enable
              <strong> Show full corrected photo</strong> in Region. In
              <strong> Outline</strong>, adjust <strong>Sensitivity</strong> and
              <strong> Simplification</strong>, or use <strong>Edit contours</strong>{" "}
              to correct points. <strong>Margin</strong> adds optional clearance.
              When the outline looks right, choose <strong>Add to bin</strong>{" "}
              to place it immediately. Set the pocket depth beside the bin, or choose <strong>Set later</strong>{" "}
              to arrange it first. Every pocket needs a depth before printable export.
              Choose <strong>Trace another photo</strong> for a blank canvas and photo drop zone; pockets already added to Bin stay in the project.
            </p>
          </li>
          <li className="pl-1">
            <h3 className="font-semibold">Arrange the pockets</h3>
            <p className="text-muted-foreground">
              In <strong>Bin</strong>, choose <strong>Bin size</strong> for the
              footprint and height, <strong>Construction</strong> for the base,
              rim, and solid fill height, and <strong>Materials &amp; Colors</strong>{" "}
              for colors. Switch to <strong>Layout</strong> to drag pockets
              into place. <strong>Add</strong> creates pockets and finger access.
            </p>
            <p className="mt-1 text-muted-foreground">
              For a standalone bin that needs no Gridfinity baseplate, turn on
              <strong> Construction → Flat bottom</strong>. This makes a smooth
              underside without a Gridfinity base. <strong>Stacking lip</strong>{" "}
              is a separate option; turn it off if you do not need the rim.
              Custom pockets can hold parts in repeatable positions for laser
              engraving or UV printing, including eufyMake setups.
            </p>
            <p className="mt-1 text-muted-foreground">
              For flat-bottomed positioning jigs, consider <strong>Through</strong>{" "}
              under a pocket’s <strong>Depth</strong> settings to save filament.
              The parts rest directly on the work surface while the pocket walls
              hold them in position. Keep a pocket floor when the jig needs to
              support the parts, set their height, or carry them between work areas.
            </p>
            <p className="mt-1 text-muted-foreground">
              Select a pocket on the canvas or in <strong>Pockets</strong> to edit
              its <strong>Depth</strong>, <strong>Size &amp; scale</strong>, or
              <strong> Position &amp; rotation</strong>. Use <strong>Move</strong>{" "}
              or <strong>Rotate</strong> on the toolbar; select several objects
              with their checkboxes or Shift/Ctrl/⌘-click to arrange them together.
              More toolbar actions appear under <strong>Tools</strong> when space
              is limited.
            </p>
          </li>
          <li className="pl-1">
            <h3 className="font-semibold">Check dimensions and fit</h3>
            <p className="text-muted-foreground">
              Compare the Layout ruler measurements with the real tools. Check
              depths and the remaining floor in <strong>3D</strong>, or use
              <strong> Check fit → Inspect inside</strong> for a cross-section.
              Under <strong>Prepare fit test templates</strong>, choose
              <strong> Full surface</strong> or <strong>Tool outlines</strong>.
              We recommend a thickness of <strong>0.6–0.8 mm</strong> for fit checks.
              Choose <strong>Save surface fit test STL</strong>.
              Print at <strong>100% scale</strong> and try your tools. This checks
              surface openings, not pocket depth or baseplate fit.
            </p>
          </li>
          <li className="pl-1">
            <h3 className="font-semibold">Export and print</h3>
            <p className="text-muted-foreground">
              Open <strong>Export</strong>, review any warnings, and choose
              <strong> Save 3MF</strong> or <strong>Save STL</strong>. Multi-color
              3MF keeps your selected colors. In your slicer, use
              <strong> 100% scale</strong>, choose filament and print settings,
              and review the layer preview before printing.
            </p>
          </li>
          <li className="pl-1">
            <h3 className="font-semibold">Save for later</h3>
            <p className="text-muted-foreground">
              In <strong>Project</strong>, choose <strong>Save this draft to Library</strong>{" "}
              to name a new design. Named projects save changes in this browser;
              reopen them from <strong>Library</strong>. <strong>Export project</strong>{" "}
              downloads an editable backup with your project colors;
              <strong> Import Project</strong> restores it to this browser’s library.
              Keep backups to move designs between browsers or devices.
            </p>
          </li>
        </ol>

        <div className="space-y-2 border-t pt-3 text-sm text-muted-foreground">
          <p>
            <strong>On a phone:</strong> switch between Trace, Bin, and Library
            using the workspace menu at the top. In Bin, use <strong>Workflow</strong>{" "}
            to find a section, <strong>Adjust</strong> for quick changes, or
            <strong> All properties</strong> for the full editor. Move and Rotate
            keep the canvas clear; <strong>Adjust</strong> opens their exact values
            below or beside it. <strong>Done</strong> hides those values while
            keeping the tool active. Redo, navigation, and history are under
            <strong> Tools</strong>. App settings and Help are in <strong>More options</strong>.
          </p>
          <p>
            <strong>Surface text:</strong> use <strong>Add → Surface text</strong> to
            create labels with built-in or supported system fonts. Text editing is
            available by default.
          </p>
          <p>
            <strong>Optional tools:</strong> adjustable empty-bin walls and linked
            designs require <strong>App settings → Enable
            experimental features</strong>. The steps above work without them.
            Opening a project keeps your preference; existing experimental
            geometry stays visible and exportable.
          </p>
          <section aria-label="Feedback" className="flex flex-wrap gap-x-5 text-xs">
            <a className="inline-flex min-h-11 items-center text-primary underline underline-offset-4" href="https://github.com/wcscr/pocketry/issues/new" target="_blank" rel="noopener noreferrer">Report an issue on GitHub<span className="sr-only"> (opens a new tab)</span></a>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
