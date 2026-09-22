# Mobile feedback implementation

This implements the full review in `agy-feedback-mobile.md`, including the landscape issue [#87](https://github.com/wcscr/pocketry/issues/87). The implementation is based on `origin/main` at `5382088`.

## Changes

| Feedback | Implemented behavior |
| --- | --- |
| Phone landscape switches to desktop; initial desktop flash | The layout is read synchronously on the first client render. Compact widths remain mobile, as do touch viewports below 1024 px wide and 600 px high. Larger tablets and desktop windows retain resizable panels. Header controls use the same decision. Trace's expanded actions can sit beside the canvas in short landscape viewports. |
| Keyboard changes the responsive layout | The layout choice is held while an input is focused and through keyboard dismissal. The app shell follows the visual viewport so primary actions remain above the keyboard. |
| Rotation and resize targets collide | Touch controls separate rotation from the north resize handle by 52 screen pixels. Touch picking chooses the nearest handle within 22 px; touch selection allows 8 px of motion before dragging. Mouse behavior remains precise. |
| Split pocket traps pinch gestures and rejects modest release misses | Split and basic-shape drawing register both fingers with viewport navigation. A second finger cancels the provisional edit and starts navigation. Touch split endpoints allow 24 px on press and 32 px on release, then project onto the edge; geometric split validation still applies. Resize and pointer cancellation discard drafts. |
| Contour taps become pans | Touch contour insertion allows 12 px of motion, with mouse tolerance kept at 6 px. A resize cancels and rolls back an active point drag. |
| Magnifier is covered by the dragging hand | On compact canvases the magnifier moves away when the finger approaches within 80 px. A 40 px improvement threshold prevents corner oscillation. Magnification and desktop sizing remain unchanged. |
| Unclear 3D touch navigation | A visible orbit/pan toggle chooses the one-finger action. Two fingers pan and zoom. The app continues to use a fixed canvas workspace with scrolling inside its settings panels. |
| 3D ruler targets shrink with zoom | Picking uses projected contour segments and a 28 CSS px touch radius, with perspective-correct conversion back to model coordinates. Mouse radius is 10 px. A reticle and missed-edge feedback show the result. Movement, a second pointer, cancellation, and resize do not commit provisional measurements. |
| Ruler keyboard occlusion and changing confirmation buttons | Decimal text input accepts both a dot and comma. One primary **Confirm scale** action validates the value, dismisses the input, and continues to region selection. Enter follows the same path. While typing, the photo frames both ruler endpoints as the canvas resizes. |
| Dismissed hints return when changing tools | Trace hint dismissal belongs to the source and workflow step, independent of pan/edit mode. |
| Blocking mobile welcome | First use is uninterrupted. **Give mobile feedback** is available under **More options**. |
| Small footprint targets | Eligible cells have a 12 screen px near-miss allowance. Containment wins, and ambiguous equal-distance misses do nothing. Touch shows a provisional cell and commits on release; dragging, pinching, and cancellation do not change the footprint. Existing adjacency and topology validation remain in force. |
| Drawing basic pockets hides dimensions under the thumb | Mobile/touch users can enter exact circle, square, or rectangle dimensions and depth, then **Place in center**, or choose **Draw on canvas**. Invalid values and cancellation do not create shapes. A submitted pocket is one undoable placement. The dialog fits the visible area above the keyboard. |

## Review corrections

The prior 3D snap tolerance was 5 mm in the current checkout, not the report's 1.5 mm. Ruler input already had decimal input and an Enter hint, and direct basic-pocket drawing already displayed dimensions. The changes address the remaining interaction problems without relying on those outdated details. A browser's `enterKeyHint` does not guarantee an iOS keyboard accessory, so the visible confirmation button remains available.

## Validation

- `npm run check`: passed.
- `npm test`: 1,784 tests passed across 112 files. Server tests require permission to bind localhost in this environment.
- `npm run build`: passed. Existing bundle-size, browser-data age, and Manifold externalization warnings remain.
- `git diff --check`: passed.
- Automated coverage includes first-render media decisions at 390×844, 667×375, 844×390, 915×412, and 932×430; tablet/desktop boundaries; retained canvas identity and draft through orientation changes; keyboard resize; split/basic-drawing pinch cancellation; touch insertion jitter; magnifier repositioning; projected ruler geometry; footprint picking; and exact-dimension input.
- In-app browser checks exercised a real photo through explicit detected-scale acceptance, region detection, contour tools, naming and adding both detected pockets to the bin, a 25 mm circle, undo/redo, 3D orbit/pan controls, two-point 3D measurement, and the export drawer. Manual ruler entry accepted a decimal comma and advanced to region selection with the single primary confirmation. Portrait 390×844 and compact landscape 667×375 were inspected, and desktop controls and navigation remained available at 1440×900.

Physical iOS Safari and Android Chrome checks remain necessary for actual soft-keyboard animation, finger contact, two-finger interaction, and device rotation. The available browser controls provide a fine pointer and viewport resizing, not physical touch emulation; automated touch-pointer tests cover the event paths but do not substitute for those device checks.
