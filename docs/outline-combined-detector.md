# Combined outline detector

This local integration starts from `claude/outline-detection-pathologies` at
`5aefd804`. It retains the same dark-on-paper segmentation, sheet-print removal,
TEED inference, reconstruction, and fallback decisions. It adds geometric
preservation checks, source-photo sampling, and explicit user corrections.
There is no printing-uncertainty mask or experimental source-edge fitting stage.

## Detection and corrections

New sessions default to **Tool edges · white sheet**. Automatic background
selection and Color contrast remain available; saved drafts retain their method.
Sensitivity and the point simplification slider are under **Manual detection
settings**. **Editable curves** sits below the main outline actions.

The automatic detector still receives Claude's copy with inferred sheet ink
removed. It preserves the original input separately. **Correct → Mark tool** or
**Mark paper** supplies local hard seeds to a bounded region solve using that
original appearance. Tool marks permit additions; paper marks permit removals.
Unmarked distant pixels retain the automatic proposal. Marks are checked again
against the final contour before clearance. An unsatisfied mark produces an error
and leaves the previous contour intact.

The correction controls support mouse/touch strokes, cancel, removal of the last
mark, and clearing all marks. Undo manual contour edits before correcting a
detection. Marks survive draft recovery and photo rotation; a new selected region
clears them. Appearance alone still cannot distinguish all shadows, reflections,
printing, or transparent parts. A stroke is an explicit constraint, not proof
that the surrounding inferred boundary is correct.

Sheet-print removal itself is unchanged. It can erase a short dark object wholly
inside a text area or an object crossing a solid marker area. Correction can
recover such material from the retained pixels, but automatic detection is still
subject to those limitations.

## Geometry and source coordinates

The unsmoothed accepted silhouette is retained independently of its presentation.
Smoothing, simplification, and final curve cleanup are checked against it, with
an inward allowance equal to the requested detail tolerance, with a minimum
of 0.1 mm (0.5 working pixels without calibration). The outward boundary
allowance is 1 mm (4 working pixels without calibration). All lengths are mapped
to detection pixels together. A spatial index and adaptive segment checks
certify the distance bound between vertices; topology checks reject crossed
rings and overlapping tools. Filling a narrow recess is bounded across its
mouth, rather than rejected because the old recess was deep. Work limits reject
an uncertified result.
A conservative simplification or the accepted silhouette is the fallback. These
checks protect detected material; they cannot recover material segmentation
already missed. User clearance is applied afterward.

The **Manual detection settings** simplification control applies the user's chosen tolerance to
the refinement source. It does not silently cancel the adjustment under the
automatic detector's fixed minimum allowance. Automatic cleanup also uses the
same detail budget as detection; a separate sub-pixel cap previously defeated
smoothing and caused the Craftsman regression.

New perspective corrections retain the exact homography back to the original
photo. Tool detection samples a bounded original-image tile and reprojects the
selected region in the worker. The tile and output are each capped at a
2048-pixel long side. Existing drafts without this mapping keep the previous
working-raster path. Rotation composes the mapping; cancelled or stale requests
cannot replace a newer detection. Exports keep the existing working-coordinate
calibration and single conversion to millimetres.

## Evaluation

The evaluator retains `--sheet-ink on|off` and adds `--hints prompts.json` for
separate assisted runs. A prompts file maps case names to correction strokes in
captured input pixels. Automatic comparisons use no marks.

New captures record the exact input-to-working transform. Legacy captures remain
valid for comparing detector output on the same pixels, but cannot establish
exact app replay by fitting contour bounds. Replay checks compare both complete
boundaries, so short notches cannot hide below a percentile threshold. Empty or
unmeasurable outputs count as missing-material failures when a reference exists.

See the [November 11 comparison](outline-combined-validation-2026-11-11.md) for
the initial 36-case results and the [Craftsman follow-up](outline-craftsman-fix-2026-11-11.md)
for the corrected comparison, manual controls, and expanded photo coverage.

## Local provenance review

Dependencies and third-party code/assets: **None added or changed.** This combines
existing Pocketry work with maintainer-requested original implementation and
tests. A maintainer-photo crop was added as a regression fixture; its source hash
and preparation are recorded in `client/src/lib/detect/fixtures/README.md`.
Claude's baseline remains in the branch ancestry; existing notices and
attribution are preserved. No package version, PR, publication, deployment, or
hosted CI run is part of this local integration.
