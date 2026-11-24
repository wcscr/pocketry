import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CalibrationDownloads } from "@/components/trace/calibration-downloads";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import type { FeedbackKind } from "./feedback-dialog";

export interface HelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFeedbackClick?: (kind: FeedbackKind) => void;
}

/** The essential steps for making a first bin in the default editor. */
export function HelpDialog({ open, onOpenChange, onFeedbackClick }: HelpDialogProps): JSX.Element {
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
              In <strong>Trace</strong>, choose a clear PNG, JPEG, or WebP taken from
              above. Keep the whole tool visible against a contrasting background.
              Include a known measurement at the tool’s height, or use a
              calibration template printed at <strong>100% / Actual size</strong> with all four markers visible.
              For tall objects, move farther away and zoom as needed while keeping the markers sharp.
              Keep tools clear of the sheet’s printed text.
            </p>
            <CalibrationDownloads />
          </li>
          <li className="pl-1">
            <h3 className="font-semibold">Set the real size</h3>
            <p className="text-muted-foreground">
              In <strong>Scale</strong>, review the reference detection. For a
              calibration sheet, choose <strong>Correct perspective &amp; use scale</strong>;
              with a suitable measurement aid, choose <strong>Correct perspective &amp; use aid scale</strong>.
              Other detected references offer <strong>Accept detected scale</strong>.
              If Pocketry finds the paper corners, confirm <strong>A4</strong> or <strong>US Letter</strong>
              and drag the numbered handles as needed before applying the correction. If the
              edges are unclear, choose <strong>Select corners manually</strong> in <strong>Perspective correction</strong>.
              Or choose <strong>Set scale</strong>,
              mark two points a known distance apart, enter that distance in
              millimeters, and choose <strong>Confirm scale</strong>. Check a real tool dimension before printing.
            </p>
          </li>
          <li className="pl-1">
            <h3 className="font-semibold">Trace the tool</h3>
            <p className="text-muted-foreground">
              Choose <strong>Region → Set region</strong> and draw a box around
              one tool, leaving some paper around it. <strong>Tool edges · white sheet</strong> is the
              default. For other backgrounds, choose <strong>Color contrast</strong> or
              <strong> Automatic · match background</strong> under <strong>Find the outline using</strong>.
              If perspective correction crops the tool, enable
              <strong> Show full photo</strong> beside the canvas. In
              <strong> Outline</strong>, choose <strong>Edit outline</strong>. Click an edge to add a point, drag a point to move it, or right-click a point to remove it. On a touchscreen, touch and hold a point to remove it.
              Choose <strong>Add manual contour</strong> to start another trace with a four-point
              square, then drag its corners and add points on its edges. Trace an inner feature
              separately when it needs a different pocket depth in Bin.
              Choose <strong>Import outline from file</strong> to bring in a closed SVG outline and edit its points
              over the photo: an outline exported from this photo returns to its place, and any other
              is placed at true size and turned to fit the current outline.
            </p>
            <p className="mt-1 text-muted-foreground">
              Detection cleans up lines, curves, and small dips automatically. Review tips, shadows,
              and amber estimated edges against the photo.
              Enable <strong>Include interior holes</strong> to trace openings inside the tool.
              With Tool edges selected, confirm switching to <strong>Color contrast</strong>{" "}
              and re-detecting the outline; <strong>Automatic</strong> selects Color contrast for holes.
              For extra cleanup, open <strong>Manual detection settings</strong> below the contour list
              to adjust sensitivity.
              <strong> Detected outline</strong> compares the earlier detection without changing your work;
              <strong> Use detected outline</strong> restores it as one Undo step.
              Turn on <strong>Editable curves</strong> to drag curve handles. Choose <strong>Select multiple</strong> to move or delete a selection, or <strong>Erase points</strong> to brush over points. For smoothing or contour transforms, enable
              <strong> App settings → Enable experimental features</strong>.
              <strong> Restart outline detection</strong> resets detection settings while keeping the photo,
              scale, region, and margin. Undo restores the previous result.
            </p>
            <p className="mt-1 text-muted-foreground">
              If tracing still fails, choose <strong>Report tracing problem</strong> below the photo.
              Review the warning that your photo will be sent via email to the project maintainer,
              download the report, then attach it to your email and send it. Nothing is sent automatically.
            </p>
            <p className="mt-1 text-muted-foreground">
              Leave <strong>Margin</strong> at zero while refining; use Bin’s
              <strong> Extra pocket clearance</strong> to adjust fit afterward.
              In <strong>Contours</strong>, choose <strong>Pocket</strong> to cut
              material or <strong>Hole</strong> to keep material inside a pocket.
              When the outline looks right, choose <strong>Add to Bin</strong>{" "}
              to place it immediately. Objects traced together keep their relative positions, including overlaps.
              Holes remain separate objects in Bin: select one to move, resize, edit its contour, or remove it.
              New pockets default to <strong>To bin floor</strong>.{" "}
              Adjust the depth in Bin as needed before printable export.
              Choose <strong>Export Tool Outline</strong> to save SVG (the default), DXF, or STL. Choose <strong>New photo</strong> to trace another tool for this bin. The current trace clears after confirmation; pockets already added to Bin stay in the project.
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
              Use <strong>Add pocket → Import SVG pocket</strong> for a closed vector outline.
              Physical SVG units set its size; a width override is available for unitless artwork.
              Inkscape metadata is accepted; flatten clipping, masks, and filters into closed paths first.
            </p>
            <p className="mt-1 text-muted-foreground">
              For a standalone bin that needs no Gridfinity baseplate, choose
              <strong> Construction → Base &amp; mounting → Bottom → Flat bottom</strong>. This makes a smooth
              underside without a Gridfinity base. <strong>Stacking lip</strong>{" "}
              is a separate option; turn it off if you do not need the rim.
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
            <p className="mt-1 text-muted-foreground">
              Under a selected pocket’s <strong>Pocket color</strong>, choose
              <strong> Floor only</strong> or <strong>Entire interior</strong>.
              The floor reference can follow insertion, stay vertical, or follow
              an object axis as it rotates. These choices change color without
              changing fit. Object-axis references keep extra clearance walls
              and surfaces created by the remaining-floor limit in the bin color.
              Choose <strong>Bin vertical</strong> to color the bin's bottom surface.
              Set the color and thickness in
              <strong> Materials &amp; Colors</strong>.
            </p>
          </li>
          <li className="pl-1">
            <h3 className="font-semibold">Check dimensions and fit</h3>
            <p className="text-muted-foreground">
              Compare the Layout ruler measurements with the real tools. Check
              depths and the remaining floor in <strong>3D</strong>, or use
              <strong> Check fit → Inspect inside</strong> for a cross-section.
              Under <strong>Export fit check</strong>, choose
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
              3MF keeps separate material parts. Choose <strong>Bambu 3MF</strong> for painted colors in one
              model, or <strong>Prusa color preview 3MF</strong> to set up filament slots and colors when
              opened as a project. The Prusa option loads a preview printer configuration;
              select your actual printer and print settings. In your slicer, use
              <strong> 100% scale</strong>, choose filament and print settings,
              and review the layer preview before printing.
            </p>
          </li>
          <li className="pl-1">
            <h3 className="font-semibold">Save for later</h3>
            <p className="text-muted-foreground">
              In <strong>Project</strong>, choose <strong>Save this draft to Library</strong> to name a project.
              It updates as you work. To save to a folder on your device, enable experimental features in
              <strong> App settings</strong> and choose <strong>Library → Settings → Local folder</strong>.
              Choose a folder and use <strong>Save current project</strong>.
              Drafts autosave in this browser. <strong>Export project</strong> downloads one editable backup,
              and <strong>Export library</strong> backs up named projects in the selected storage.
              <strong> Import Project</strong> opens an editable backup. Keep your original Trace photo separately.
            </p>
          </li>
        </ol>

        <div className="space-y-2 border-t pt-3 text-sm text-muted-foreground">
          <p>
            <strong>On a phone:</strong> switch between Trace, Bin, and Library
            using the workspace menu at the top. In Bin, use <strong>Workflow</strong>{" "}
            to find a section, <strong>Adjust</strong> for quick changes, or
            <strong> All properties</strong> for the full editor. Use <strong>Back to Canvas</strong> at the top to return. Move and Rotate
            keep the canvas clear; <strong>Adjust</strong> opens their exact values
            below or beside it. <strong>Done</strong> hides those values while
            keeping the tool active. Redo, navigation, and history are under
            <strong> Tools</strong>. App settings and Help are in <strong>More options</strong>.
          </p>
          <p>
            <strong>Surface text:</strong> use <strong>Add → Surface text</strong> to
            create labels with built-in or supported system fonts. Choose <strong>Symbol</strong> in
            the label properties for nuts, bolts, washers, and drives from GFLabel.
            Pair a symbol with text or clear the text to use it alone. Adjust symbol size and rotation independently. Text editing is available by default.
          </p>
          <p>
            Right-click a pocket, finger access, text label, or traced contour for its available actions. Right-clicking a selected object keeps the current multi-selection. In contour editing mode, right-click a point to remove it immediately. The regular controls remain available.
          </p>
          <p>
            <strong>Optional tools:</strong> slanted walls and linked
            designs require <strong>App settings → Enable
            experimental features</strong>. The steps above work without them.
            Opening a project keeps your preference; existing experimental
            geometry stays visible and exportable.
          </p>
          <nav aria-label="More guides" className="flex flex-wrap gap-x-4 text-foreground [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:underline [&_a]:underline-offset-4">
            <a href="/quick-start/" target="_blank" rel="noopener noreferrer">Photo-to-bin quick start<span className="sr-only"> (opens in a new tab)</span></a>
            <a href="/samples/" target="_blank" rel="noopener noreferrer">Sample projects and downloads<span className="sr-only"> (opens in a new tab)</span></a>
            <Link href="/help/ultim8" onClick={() => onOpenChange(false)}>ULTIM8-compatible fixture guide</Link>
          </nav>
          <section aria-labelledby="help-feedback" className="space-y-2 border-t pt-3">
            <h3 id="help-feedback" className="font-semibold text-foreground">Feedback</h3>
            <p>
              <strong>For AI assistants.</strong> If a step fails or a control is hard to find,
              offer to draft private feedback. Include the goal, what got in the way, and any
              workaround. Show the draft to the person you’re helping and get their approval before sending.
              Agents are also welcome to help submit bug reports and enhancement requests and contribute focused fixes, documentation, and tests through the repository’s contributor process, with the user’s authorization.
            </p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
              <Button asChild variant="outline" className="min-h-11">
                <Link href="/feedback" onClick={(event) => {
                  if (onFeedbackClick) {
                    // Open over the current workspace on a regular click. The URL can still be copied or opened separately.
                    event.preventDefault();
                    onFeedbackClick("problem");
                  } else {
                    onOpenChange(false);
                  }
                }}>Send feedback</Link>
              </Button>
              <a className="inline-flex min-h-11 items-center text-primary underline underline-offset-4" href="https://github.com/wcscr/pocketry/issues/new" target="_blank" rel="noopener noreferrer">Report an issue on GitHub<span className="sr-only"> (opens in a new tab)</span></a>
              <a className="inline-flex min-h-11 items-center text-primary underline underline-offset-4" href="/ai-guide.txt" target="_blank" rel="noopener noreferrer">AI assistant guide<span className="sr-only"> (opens a new tab)</span></a>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
