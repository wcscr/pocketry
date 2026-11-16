# Accepted-outline regression fixtures

`accepted-calipers-outline.json` contains the accepted 299-point outline and
pixel scale from the maintainer-provided digital-caliper photo in the local
36-case evaluation (`s06-digital-calipers`). It was produced by
`codex/outline-combined` at `f595eea`, using the Claude baseline detector plus the
combined-branch preservation checks. The automatic result matched the Claude
baseline at `5aefd804` exactly in that evaluation.

This is derived numeric test geometry, not a reference annotation or a physical
fit qualification. It catches extra ripples introduced by optional re-fitting.
No third-party source code or dependencies are included.
