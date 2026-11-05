# Pocketry documentation

The [project README](../README.md) introduces the application and local setup.
[GitHub issues](https://github.com/wcscr/pocketry/issues) are the roadmap: use them
for enhancement requests, problem reports, priorities, and current work status.
Documentation describes implemented behavior, architecture, and constraints.

Contributors update affected documentation with their changes and add a short
**Unreleased** changelog entry for user-visible changes. Maintainers review those
entries and own release versions and dates. Documentation-only changes, tests,
and internal refactors usually need no changelog entry.

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
- [ULTIM8-compatible fixtures](ultim8-peg-bottom.md).
- [Contour symmetry](contour-symmetry-prototype.md) and
  [calibration aids](calibration/object-reference-strip.md).
- [DXF compatibility](dxf-compatibility.md) and [import limits](import-limits.md).
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
  [reflective-photo validation](reflective-photo-validation.md).
- [Workflow-layout design](prototypes/selection-inspector.md), [mobile review](mobile-ux-review.md), [mobile implementation](mobile-feedback-implementation.md),
  [experimental-control testing](experimental-controls-adversarial.md), and
  [UI audit plan](ui-audit-fixes-plan.md).
- [Fixture-entry design](ultim8-entry-plan.md) and [hardware-symbol design](hardware-symbols-plan.md).
- [Community-library proposal](community-library-plan.md): an unimplemented design
  proposal, separate from the existing browser-local library and bundled samples.

Keep reports dated and preserve the distinction between code checks, browser
tests, serialized exports, slicer checks, and physical prints. Add new feature
references here so contributors can find the current description.
