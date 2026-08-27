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
- Calibrate image dimensions and refine exterior contours and interior holes.
- Export traced geometry as SVG, DXF, DWG-compatible DXF, or STL.
- Arrange traced tools as pockets in Gridfinity bins.
- Configure full-, half-, and quarter-pitch bins and export STL or 3MF models.
- Export top-down layouts for shadow boards and CNC workflows.

Pocketry is still subject to physical print validation. Inspect generated files
and confirm dimensions and printer settings before relying on them for a final
part.

Perspective correction rectifies the flat reference plane represented by the
calibration sheet or four selected paper corners. Thick tools extend above that
plane and can still show parallax when photographed at an angle. A future
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
