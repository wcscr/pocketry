# Pocketry documentation

The [project README](../README.md) introduces the application and local setup.
[GitHub issues](https://github.com/wcscr/pocketry/issues) are the roadmap: use them
for enhancement requests, problem reports, priorities, and current work status.
Documentation describes implemented behavior, architecture, and constraints.

Contributors update affected documentation with their changes and add a short
**Unreleased** changelog entry for user-visible changes. Maintainers review those
entries and own release versions and dates. Documentation-only changes, tests,
and internal refactors usually need no changelog entry.

## Start here

- [Connected project folders](library-folder.md)
- [Local automation CLI and MCP](local-automation.md)
- [Photo-to-bin quick start](https://pocketry.xyz/quick-start/) and [sample downloads](https://pocketry.xyz/samples/).
- [Photo-to-bin tutorial](../README.md#basic-process) and
  [tutorial image sources/capture steps](images/README.md).
- [Self-hosting](self-hosting.md): Node 26 (required since 1.12.0), Docker,
  static hosting, upgrades, and browser-local backups.
- [In-app Help](../client/src/components/help/help-dialog.tsx): the shipped guide
  available from Help, or More options on a phone.
- [Reporting a tracing problem](tracing-photo-reports.md): original-photo reports sent by email.
- [AI assistant guide](../client/public/ai-guide.txt) and [AI information index](../client/public/llms.txt): measurement review, editable bin handoff, local automation, and feedback.
- [Sample projects](../samples/README.md): 16 editable designs, original print
  photos, and variant-specific limits.

## Contributor and maintainer guidance

- [Contributing](../CONTRIBUTING.md): workflow, dependency/provenance review, and attribution.
- [CLA](../CLA.md), [licensing FAQ](contribution-licensing-faq.md), and
  [acceptance privacy](contributor-privacy.md).
- [Agent instructions](../AGENTS.md) and [repository rules](../CLAUDE.md): architecture,
  local checks, and contribution requirements; personal instructions remain local.
- [Maintainer checklist](contribution-maintenance.md): acceptance records and integration checks.
- [License](../LICENSE), [third-party notices](../NOTICE), and
  [upstream port provenance](../client/src/lib/gridfinity/UPSTREAM.md).

## Current feature references

- [Bin designer implementation](gridfinity-plan.md): capabilities, architecture,
  persistence, exports, and physical-verification boundaries. Its legacy filename
  is retained for existing links; it is not a roadmap.
- [Grid pitch](grid-pitch.md), [compartments and label tabs](bin-compartments.md),
  [bottom edge fillets](bottom-edge-fillet.md), and [slanted walls](slanted-walls-prototype.md).
- [Pocket selection and transforms](pocket-tilt.md), [rotation and elevation](pocket-rotation.md),
  [insertion clearance](pocket-insertion-paths.md), and [split pockets](split-pockets.md).
- [Hardware symbols and label surfaces](hardware-symbols.md).
- [ULTIM8 fixture guide](https://pocketry.xyz/help/ultim8) and [geometry reference](ultim8-peg-bottom.md).
- [Learned outer outlines](teed-outline-integration.md) and [editable curves](contour-curves-prototype.md).
  [How outlines are evaluated](outline-evaluation.md); the
  [detection plan](outline-detection-plan.md) is a proposal, not implemented behavior.
  [Combined detector](outline-combined-detector.md) describes source sampling,
  experimental correction brushes, reconstruction, and the geometry preservation checks.
  The [1.9 → 1.10 release comparison](outline-detection-1.9-to-1.10.md)
  shows every maintainer-selected reference photo at the released defaults.
  The [November 12 full-workflow comparison](outline-full-workflow-validation-2026-11-12.md)
  records the earlier branch results on all 36 tools; the
  [November 14 straightening check](outline-straightening-validation-2026-11-14.md)
  covers the bridging of small dips on seven of them.
- [Contour symmetry](contour-symmetry-prototype.md) and
  [calibration aids](calibration/object-reference-strip.md).
- [SVG import and Trace positioning](../README.md#2-arrange-the-pockets),
  [DXF compatibility](dxf-compatibility.md), [Bambu/Prusa 3MF](bambu-3mf-compatibility.md),
  and [import limits](import-limits.md).
- [Bundled npm notice maintenance](../licenses/npm/README.md).
- [Self-hosting and browser-local backups](self-hosting.md).
- [Sample designs and print evidence](../samples/README.md) and [branding assets](branding/README.md).

## Investigation and design records

These preserve specific baselines, proposals, measurements, or validation results.
They are not the current roadmap or proof that a later build has passed the same
checks. Use the current feature references and source for present behavior, and
issues for remaining work. A proposal is not a shipped feature.

- [Original dependency review](open-source-review.md).
- [Preview performance](preview-performance.md), [pocket dragging](pocket-drag-performance.md),
  [geometry export integrity](geometry-export-integrity.md),
  [surface rounding](pocket-surface-rounding.md), and [label supports](label-tab-support.md).
- [Detector backend comparison](detector-backend-validation.md) and
  [reflective-photo validation](reflective-photo-validation.md), plus
  [GrabCut and neural-boundary evaluation](photo-refinement-evaluation.md).
- [Workflow-layout design](prototypes/selection-inspector.md), [mobile review](mobile-ux-review.md), [mobile implementation](mobile-feedback-implementation.md),
  [experimental-control testing](experimental-controls-adversarial.md), and
  [UI audit plan](ui-audit-fixes-plan.md).
- [Fixture-entry design](ultim8-entry-plan.md) and [hardware-symbol design](hardware-symbols-plan.md).
- [Outline-control](outline-controls-2026-11-11.md),
  [simplification](outline-simplification-fix-2026-11-11.md),
  [original-photo UI](outline-ui-validation-2026-11-11.md),
  [default smoothing](outline-default-smoothing-validation-2026-11-11.md), and
  [correction toolbar](outline-correction-ui-validation-2026-11-12.md) validation:
  earlier controls/results, superseded where noted by current feature references.
- [Historical sample announcement draft](reddit-samples-draft.md).
- [Community-library proposal](community-library-plan.md): an unimplemented design
  proposal, separate from the existing browser-local library and bundled samples.

Older reports retain their original Node versions, control labels, and results;
use the setup and feature references above for current instructions.

Keep reports dated and preserve the distinction between code checks, browser
tests, serialized exports, slicer checks, and physical prints. Add new feature
references here so contributors can find the current description.
