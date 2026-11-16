# Contributing to Pocketry

Issues and focused pull requests are welcome. Discuss substantial features or
new dependencies before investing in an implementation. Small fixes can go
straight to a PR.

[GitHub issues](https://github.com/wcscr/pocketry/issues) are the roadmap for
enhancement requests and problem reports. Use the [documentation index](docs/README.md)
for current behavior and architecture.

Maintainers screen every issue, contribution, and PR with Daybreak Blue for
security risks, including malicious or hidden instructions. This check is owned
by maintainers; contributors need not run Daybreak Blue. Keep submitted text,
files, and links relevant to the report or change, and never include secrets.

## Submitting a change

1. Explain what the change fixes or adds. Keep unrelated changes separate.
   Update affected documentation. For a user-visible feature or fix, add a short
   **Unreleased** entry in [CHANGELOG.md](CHANGELOG.md) describing its impact.
   Documentation-only changes, tests, and internal refactors usually need none.
2. Run the local checks below and report results.
3. Include a dependency/provenance review: list affected material, or write
   **None added or changed**. Maintainers handle the detailed compatibility review.
4. Accept [Version 1 of the CLA](https://github.com/wcscr/pocketry/blob/main/CLA.md#accept-once)
   once before your work is incorporated, using its individual or organization
   acceptance statement. You can accept privately by emailing
   pocketry@sugarcreekresearch.com. Later PRs usually need
   no further action unless the terms, rights holder, or your authority change.

Identify everyone whose original work is included, and any employer or other
organization that owns rights in that work. CLA acceptance must cover those
rights holders—not just the person opening the PR. If you're unsure about
ownership or authorization, ask us. Private details can be emailed to
pocketry@sugarcreekresearch.com.

Maintainers review and edit changelog entries, combine related items, and set
release versions and dates. You do not need to bump the version for a normal PR.

## Keeping documentation consistent

Check instructions against the current target branch and rendered controls.
Update the [README tutorial](README.md#basic-process), [in-app Help](client/src/components/help/help-dialog.tsx),
and affected references in [docs](docs/README.md) together. For runtime or hosting
changes, check `.nvmrc`, `package.json`, `Dockerfile`, the README setup, and the
[self-hosting guide](docs/self-hosting.md), including the first affected release.
Refresh screenshots when the pictured controls change and record their source,
version, and capture steps in [the image notes](docs/images/README.md).

Keep dated reports and physical-print photos as evidence for their recorded
versions. Label superseded instructions as historical and link to current
guidance; do not rewrite old test results as if they qualified today's build.
Never copy private local preferences or contributor records into public docs.

## Licensing in plain language

You keep ownership of your work and can use or license it elsewhere. Original
contributions are submitted under AGPL-3.0. The CLA also allows Sugarcreek
Research, LLC to use them in Pocketry or other products under other licenses,
including proprietary licenses, without royalties. Contributions published in
Pocketry's public repository remain under AGPL; privately licensed versions need
not be published under the CLA. Existing licenses and others' rights still apply.

The CLA itself creates no confidentiality obligation. Arrange any needed embargo
or confidentiality terms separately. Ordinary reports and suggestions need no CLA;
private patches deliberately offered for inclusion follow the same contribution
process. See the optional [FAQ](docs/contribution-licensing-faq.md) and
[acceptance privacy notice](docs/contributor-privacy.md).

## Dependencies and provenance

Every submission needs this review, including private patches. For new or changed
packages, copied/adapted code, fonts, icons, binaries, or other assets, give the
name, version or source revision, source URL, license, purpose, and how it is used.
Mention existing dependencies whose use changes, known restrictions, and anything
you are unsure about. Preserve required notices and help update [NOTICE](NOTICE).

For outside contributions, briefly identify material AI assistance with code,
tests, documentation, or assets and the tool used. Include the tool's
`Co-Authored-By` trailer on affected commits, using its standard attribution
identity where available; do not invent a person or email address. Maintainers
preserve that credit when squashing. Routine autocomplete, spelling, and formatting
need no separate credit. Maintainer work covered by the project's
[standing acknowledgment of OpenAI Codex and Anthropic Claude](README.md#contributors)
need not repeat that acknowledgment in every commit or PR.

AI credit records assistance, not copyright ownership or authority to accept the
CLA. Review and test your submission yourself, and disclose known restrictions
or provenance uncertainty. Never include secrets or confidential prompts.

Maintainers check affected transitive dependencies, security advisories, AGPL and
proprietary-use compatibility, and delivered notices before incorporation. Ask
for help with uncertainty; you are not expected to supply a legal opinion.

## Local checks

Use Node.js 26 and the committed lockfile. `.nvmrc` selects the version, and
`npm ci` stops with an engine error on any other major:

```sh
node --version # Must report v26.x
npm ci
npm run check
npm test
git diff --check
```

Run `npm run build` for application/build changes and relevant geometry or UI
workflow tests described in [CLAUDE.md](CLAUDE.md). Report checks you could not run.
Do not enable or trigger hosted CI without explicit maintainer authorization.
Preserve actual human authorship and copyright notices.
