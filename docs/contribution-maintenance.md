# Maintainer contribution checklist

Maintainers own these checks. Contributors use [CONTRIBUTING.md](../CONTRIBUTING.md).
This checklist adds no license grants or contributor obligations to the [CLA](../CLA.md).

## 1. Check agreement coverage

Before incorporating original outside work into a public or private version:

- Identify all authors and rights holders, including relevant employers. Confirm
  coverage of the actual contribution, not merely the PR opener. A username,
  legal name, numeric ID, or Git author field does not prove authority.
- Look up existing acceptance. Do not make returning contributors repeat it when
  the terms, rights holder, and authority still apply. If new acceptance is needed,
  point to the [Version 1 acceptance statements](https://github.com/wcscr/pocketry/blob/main/CLA.md#accept-once).
  Confirm the named version matches the text the contributor read and accepted;
  retain its immutable full-commit-SHA URL and exact text in the record. A moving
  `main` link alone is not the record. If terms change, update the version and
  default statements together and preserve access to earlier accepted versions.
  Resolve any version mismatch with the contributor before incorporation.
  A checkbox or DCO sign-off is not a substitute.
- Offer the private email route to everyone. Obtain an organization signer's role,
  legal entity/jurisdiction, covered accounts, and authorization as needed. A
  standing employer policy must authorize the actual additional licensing grants.
  An authorized representative may update covered accounts for future submissions.
- Expressly identify earlier submissions when needed; the current identified
  submission already covers that work. Do not infer agreement from pre-CLA PRs.
  Resolve changed authority before more work is incorporated. Do not accept for
  someone else, including through an AI agent. Resolve uncertainty about legal
  capacity or signing authority before incorporation; a guardian checkbox alone
  does not establish authority.
- Obtain the target base commit from the submitted PR and retain it with the patch
  being accepted. Contributors need not copy it into a form. For an unversioned
  patch, identify the target with the contributor before incorporation; do not
  guess a "current" version or expand the original patent claim set on rebase.
- Exclude original material marked "Not a Contribution" unless coverage is resolved.
  Review identified third-party material under its own license. Paid development
  may need separate services/IP terms. Ordinary reports need no CLA.

Keep a restricted record of legal name/account and numeric ID where available,
organization and authority, exact agreement version/full SHA and text (including
its linked privacy notice), verbatim
acceptance with retained snapshot/link or email, date, and covered submission/base.
Use a non-sensitive reference publicly for private acceptance. Follow the
[privacy notice](contributor-privacy.md); review retention and remove unnecessary
data. No identity-document or redundant commit-email collection is required.

## 2. Complete the dependency and provenance review

Every submission needs a recorded review, including **None added or changed**.
For local-only work, keep it in the accompanying review note. Contributors supply
known facts; maintainers verify the following before incorporation:

- Packages and affected transitive components; copied/adapted source; binaries,
  vendored/WASM components; fonts, icons, sample files, and assets. Include changed
  use or distribution of existing material and disclosed AI provenance uncertainty.
- Exact versions/revisions, sources, actual license texts and copyright notices,
  including embedded components with different terms, and relevant security advisories.
- Actual use: development tools, server code, browser bundles, copied code, separate
  components, generated output, and redistributed tools. A development tool need
  not be relicensed with the app, but its output or redistribution may impose duties.
- Compatibility with AGPL distribution and the intended proprietary integration,
  including attribution, source, replacement/relinking, and other conditions.
  Permissive terms still require review; copyleft/custom terms need an assessment
  of the actual integration. No blanket proprietary relicensing of all tools is
  required. Do not incorporate unknown-origin or unauthorized material or an
  integration whose obligations cannot be met under both intended models.
- Required [NOTICE](../NOTICE) and license-file updates for direct dependencies,
  bundled artifacts, adapted source, and shipped transitive material. Verify notices
  reach recipients after bundling. The CLA cannot expand third-party permissions.
  Repository-specific exclusions in [CLAUDE.md](../CLAUDE.md) still apply.

Help contributors resolve missing facts; record the conclusion and outstanding
items instead of requesting a legal certification from them.

Run `npm run build` when dependencies or bundled assets change and inspect the
emitted `NOTICE.txt`. The build appends full npm notices from browser and worker
chunks; missing package license files require a reviewed, version-specific
[upstream supplement](../licenses/npm/README.md). This packaging check does not
replace the compatibility review or notices for separately vendored assets.

## 3. Verify and integrate

### Review proportionately

Review as a collaborator helping a useful contribution land. Assess the intended
workflow with representative inputs, compatibility with existing behavior, and
the verification required by [CLAUDE.md](../CLAUDE.md). A first contribution does
not need to solve every adjacent problem or anticipate an evaluator's next test.

For each finding, distinguish:

- **Required before merge:** a concrete correctness, regression, build, security,
  or data-integrity problem whose impact and likelihood justify delaying the
  change, or an unmet licensing requirement. Explain the user impact and the
  smallest reasonable remedy. Identify whether the contributor or a maintainer
  will handle it; blocking merge does not automatically assign work to the author.
- **Follow-up:** uncommon compatibility cases, additional hardening, broader
  support, and polish that do not undermine the intended use. Keep these out of
  the acceptance requirements unless evidence establishes a material risk.

Stress tests are valuable maintainer work. Label constructed cases honestly and
assess their practical relevance before escalating them. Maintainers own this
testing and resulting hardening; do not turn it into a moving checklist for a new
contributor. Serious risks still need resolution, with maintainers helping carry
that work rather than requiring the contributor to anticipate it.

Keep contributor feedback short, welcoming, and specific. Explain consequences
in user terms, distinguish requests from suggestions, and offer to handle project
integration details such as license supplements and release bookkeeping. Do not
attribute pre-existing failures or requirements introduced after submission to
the contributor; maintainers help resolve them before integration as needed.

### Complete integration checks

Check local commands/results under [CLAUDE.md](../CLAUDE.md), preserve human
credit, outside contributors' AI-tool attribution, and notices, and resolve
coverage/provenance gaps before incorporation.
Check that affected documentation and any user-visible **Unreleased** changelog
entry accompany the change. Edit or combine entries as needed; maintainers set
release versions and dates.
Keep hosted CI disabled. Keep private contributor records and legal documents
out of public commits. A later proprietary delivery requires review of its
actual build, rights, notices, and customer terms; this
checklist is not clearance for every future distribution.
