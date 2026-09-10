# Pocketry

Pocketry turns photographs of tools into editable outlines, shadow-board files,
and printable Gridfinity bins. The application runs in the browser, with image
processing, project storage, and model generation kept on the user's device.

[Try Pocketry](https://pocketry.pages.dev) ·
[View the source](https://github.com/wcscr/pocketry) ·
[Read the license](LICENSE) ·
[Read third-party notices](NOTICE)

## What it does

- Detect a tool silhouette from a PNG or JPEG photograph.
- Calibrate image dimensions with a printable A4 or US Letter PDF sheet, which
  Pocketry identifies automatically, and correct camera perspective.
- Refine exterior contours and interior holes.
- Export traced geometry as SVG, DXF, DWG-compatible DXF, or STL.
- Arrange traced tools as pockets in Gridfinity bins.
- Pocket properties stay in the Pockets section. Click a pocket on the canvas
  or choose its row in the compact list to open its settings there. On phones, tapping opens
  the controls drawer; dragging keeps the layout available.
  Depth leads; size and scale, extra clearance, edges and corners, and position
  settings start collapsed. Expand the depth profile to inspect the pocket in 3D.
  Throughout Bin settings, help icons reveal optional guidance on hover, focus,
  or tap. Dimensions, warnings, save status, and active editing guidance stay visible. Use a pocket row’s
  pencil to rename it. Edit contour is in the properties header and beside the
  canvas ruler. Pocket clearance has a zero-centered slider: negative values shrink
  each edge to undo excess trace padding; positive values add room. Shrinking
  changes the 3D cutter and fit templates without altering the saved trace.
  Layout warnings and automatic packing conservatively retain the original outline
  when clearance is negative; inspect the 3D model for the resulting pocket.
- Model warnings and errors appear in a collapsible panel at the bottom right of
  the Layout and 3D canvas. Click a message to edit the affected pocket or settings.
  It starts as a compact count with a gentle pulse every four seconds until expanded
  (unless reduced motion is enabled). Errors still block export.
- Configure full-, half-, and quarter-pitch bins and export STL or 3MF models.
  Bin size places bin-unit inputs alongside each slider, with a combined outer-size
  readout in millimeters below and optional sizing guidance in hover hints.
  All pitches support the same maximum outer size of 671.5 mm per axis
  (16 full, 32 half, or 64 quarter cells), so finer pitch does not shrink the size allowance.
- Model, fit-test, and outline export dialogs include an optional, unchecked
  `.pocketry.json` download. Bin exports preserve the full design; Trace exports
  preserve the calibrated outline as an editable pocket in a new Bin project.
  When selected, both files share a filename stem.
- Export top-down layouts for shadow boards and CNC workflows.

Pocketry is still subject to physical print validation. Inspect generated files
and confirm dimensions and printer settings before relying on them for a final
part.

Perspective correction rectifies the flat reference plane represented by the
calibration sheet or four selected paper corners. The automatic path fits all
16 refined marker corners for better precision. The v2 sheets use a Pocketry-only
custom marker dictionary and require the complete four-marker signature, which
distinguishes A4 from US Letter without treating stock ArUco IDs as Pocketry.
Thick tools extend above that plane
and can still show parallax when photographed at an angle. A future
imaging improvement should investigate height-aware or multi-view correction
for those tools rather than treating a planar homography as a complete 3D
camera correction.

## Privacy

The static application processes images and generates models locally in the
browser. Projects are stored in the browser using IndexedDB. The hosted version
does not require uploading tool photographs to Pocketry's server.

## Run locally

Pocketry requires Node.js 22 and npm.

```sh
npm ci
npm run dev
```

The development server defaults to <http://localhost:5000>. If that port is in
use, choose another one:

```sh
PORT=5001 npm run dev
```

## Verify and build

Run the required type-check and test gate:

```sh
npm run check
npm test
```

Create the production build in `dist/public`:

```sh
npm run build
```

The build includes `LICENSE.txt` and `NOTICE.txt` alongside the application.

## Deploy to Cloudflare Pages

Connect the GitHub repository to a Cloudflare Pages project with these build
settings:

- Production branch: `main`
- Framework preset: None
- Build command: `npm run build`
- Build output directory: `dist/public`
- Environment variable: `NODE_VERSION=22`

Pocketry's public deployment is <https://pocketry.pages.dev>.

## License and attribution

Pocketry's original work is licensed under the
[GNU Affero General Public License v3.0 only](LICENSE). Commercial use is
permitted, but modified distributed versions and modified versions offered over
a network must comply with the AGPL's source-sharing requirements.

Third-party components and adapted source retain their original licenses. Their
licenses, copyright notices, and provenance are recorded in [NOTICE](NOTICE).
The detailed direct-source review is available in
[docs/open-source-review.md](docs/open-source-review.md).

## Contributing

Issues and pull requests are welcome. Keep changes focused, add or update tests,
run the required verification commands, and update `NOTICE` whenever adding a
direct dependency, bundled artifact, copied component, or adapted source.
