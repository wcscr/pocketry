# Hardware symbols

Choose **Add → Surface text**, then **Symbol** in the selected label's properties.

With label tabs enabled, new text starts on the next empty shelf that fits it.
**Surface → Label tabs** places text or symbols on the horizontal shelf tops,
including slanted walls and compartment dividers. Layout shades those tops at
their actual shifted positions. Hollow bins use **Label tabs** exclusively;
**Bin surface** is available only with solid fill. Opening an older hollow-bin
project or removing solid fill retargets its labels to tab height without moving,
rotating, or resizing them. Fill changes and their label updates undo together.
If tabs are disabled or clipped away,
tab text stays recoverable and export explains which surface needs restoring.
Search by hardware or drive name. A label holds one symbol, optional text,
or text alone. Clear text to print only the symbol; enter text before
selecting None. Add more labels for more symbols. Symbols share the label's raised
height, position, and text color. New raised lettering defaults to 0.5 mm,
matching the default label-tab recess so its top finishes flush with walls and
dividers. Existing saved heights are preserved. Bolts and screws start upright, with the
head at the top. **Symbol rotation** turns just the symbol; **Label rotation** turns the
whole label. The chosen symbol angle is retained when switching symbols or
selecting None. Fonts affect only the text.
The shared properties editor makes this available in standard, workflow, and
mobile layouts with the same existing surface-label restrictions.

Text appears first in the compact properties editor, then Font and Size
side by side with their labels beside the controls. Font guidance is available
inside the picker. Shared height, Label rotation, and X/Y position stay above the
Symbol picker. The symbol’s own Size, Rotation, and Text gap appear below that
picker. Text gap is available when the label has both a symbol and visible text.

Text size sets the font em size; Symbol size sets the unrotated symbol height
independently (both 2–40 mm). Existing projects keep their text and symbol sizes,
and changing text size preserves the current symbol size. The symbol is rotated first,
then placed before the vertically centered text. **Text gap** sets the space
between their visible edges (0–40 mm). Leading spaces in Text add their font's
normal space widths to this gap; trailing spaces do not change it. Existing
labels default to a quarter-em gap until edited, while an explicitly set gap
stays fixed when text or symbol size changes. The combined outline is centered at the
label position and then rotated. Existing text-only outlines are unchanged.
STL joins labels to the bin; 3MF retains each label as a separately named part.
Projects and undo history store a stable symbol ID, optional size/gap, and independent
angle (schema 54; absent angle means zero and absent symbol size inherits text
size). Old text-only labels keep their text and do not gain a default symbol.

## Source and license

The 18 bundled outlines come from [GFLabel](https://github.com/ndevenish/gflabel),
copyright 2024 Nicholas Devenish, licensed under BSD-3-Clause:

- Revision: `7c6bfbaf1e007d42ea82cf1e2d89563ab545ebe0`.
- Source: [`src/gflabel/fragments.py`](https://github.com/ndevenish/gflabel/blob/7c6bfbaf1e007d42ea82cf1e2d89563ab545ebe0/src/gflabel/fragments.py).
- Complete upstream license: [`client/public/licenses/gflabel.txt`](../client/public/licenses/gflabel.txt).
- Copyright, source, adaptations, and full license are also in [`NOTICE`](../NOTICE),
  emitted as `/NOTICE.txt` in production. About and the picker link to the project
  and `/licenses/gflabel.txt`.

The artwork retains its BSD license. Keep its notice with redistributed asset
collections or other copies of this artwork. Pocketry's license does not claim
ownership of user designs or ordinary output files. No GFLabel font, electronic
symbol asset, or label-base geometry is included; those require their own review.

## Regeneration

Ordinary development and builds only need Node. Maintainers regenerating artwork
need [uv](https://docs.astral.sh/uv/) and Python 3.11 or 3.12:

```sh
uv run --locked scripts/generate-hardware-symbols.py
```

The PEP 723 script and its committed lock pin GFLabel and the Python CAD toolchain.
`build123d==0.10.0` and `ocp-gordon==0.2.0` match GFLabel's compatible toolchain;
newer ocp-gordon expects a different OpenCascade API. These are maintenance-only
dependencies, never loaded by the app. Review their updates separately.

The generator declares each stable ID, display name, search terms, and upstream
fragment expression. It evaluates at height 6 mm, preserves line endpoints,
and omits the threaded insert's tiny corner fillets because the upstream fillet
operation can fail nondeterministically with the pinned CAD toolchain. It
samples curves at intervals no larger than 0.04 mm, turns bolt and screw side
profiles clockwise to put their heads at the top, normalizes the oriented source
bounds to height 1, and rounds coordinates to six decimals. Outer rings are
counterclockwise and holes clockwise in y-up coordinates. Rings have implicit
closing edges. The deterministic JSON records its source revision and license.
SVG previews and the existing Manifold extrusion use those same outlines.

When updating the catalog, preserve existing IDs and check schema round-trips,
holes, shape validity, supported placement, extrusion, and serialized export.
Run the symbol unit/UI tests and `npm run test:geometry -- hardware-symbols`, plus
the repository's ordinary check/test/build gates. Passing these checks does not
qualify physical printing: small drive and insert details depend on nozzle size,
layer height, and chosen label size.
