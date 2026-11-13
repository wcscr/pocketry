# Bundled npm notices

`npm run build` appends package license and notice texts to `dist/public/NOTICE.txt`.
The Vite plugins in [server/bundled-notices.ts](../../server/bundled-notices.ts)
collect packages from emitted browser and worker chunks, including transitive
dependencies and multiple installed versions. The source [NOTICE](../../NOTICE)
continues to identify adapted code, fonts, separately vendored assets, and the
direct dependency inventory. This does not replace dependency compatibility review.

Normally, texts come directly from the installed package's LICENSE, LICENCE,
COPYING, and NOTICE files. Some npm archives omit their license file.
[supplements.json](supplements.json) covers only the reviewed package versions
listed there, with source URLs pinned to the published package's npm `gitHead`.
The Radix license was identical at both listed revisions. Builds make no network
requests to obtain these texts and fail when a bundled package has no license text
or an applicable supplement.

The react-remove-scroll-bar and react-style-singleton revisions declare MIT in
their package metadata but provide no standalone license text. Their supplements
preserve that declaration and author attribution, and reproduce the standard MIT
permission and disclaimer. They do not infer a copyright holder or year.

When a dependency changes, review its actual integration and license, then build.
If a supplement is needed, obtain the exact upstream text and record the reviewed
package version and immutable source URL. Do not extend a version list without
checking the new source. Keep any additional notices supplied by the package.
Verify the generated `NOTICE.txt` and any separate asset notices before distribution.

Development's `/NOTICE.txt` serves the source inventory; a source checkout also
contains these supplements and installed package notices. Production appends the
bundle-specific texts so static-site recipients do not need `node_modules`.
