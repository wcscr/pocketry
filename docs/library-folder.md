# Connected library folders

Issue: [#98](https://github.com/wcscr/pocketry/issues/98).

Named projects use either the original browser library or a user-selected host
folder. The folder is the source of truth while connected; it is not an import
that starts a separate browser library. No server, account, cloud upload, or
origin-private filesystem is involved. Initial targets are desktop Chrome and
Edge, with feature detection and the existing browser/import/export workflow
elsewhere. Each browser/profile must grant its own read/write permission.

The library navigator searches names as you type, ignoring letter case. Each
compact row shows the name and update date; Open stays visible and the action
menu contains Rename, Copy, and Remove. Expand Storage to connect or disconnect
a folder. Permission and conflict recovery details expand automatically.

## Connection and identity

Pocketry creates a `pocketry-library` subdirectory in the chosen folder. The
connection can optionally copy browser projects, retaining all original browser
data and preserving project IDs when possible. Conflicting IDs/names get
independent copies. Unsupported project documents remain raw and unavailable for
editing, but are listed and included in library exports.

The current editor becomes an unlinked draft when connecting, disconnecting, or
resolving conflicts. Open a named project to resume automatic folder saves.
Drafts, the active project ID, the connection handle, and the last observed
revision IDs remain browser-local recovery metadata. The folder contains all
named projects, their shapes, materials, and committed undo/redo histories.
Clearing browser storage loses that connection metadata and unnamed drafts but
does not remove completed folder saves. Reconnecting recovers the named library.

## Revision format and concurrency

Each completed change appends `<UUID>.pocketry-library.json`, containing
`format: pocketry-folder-revision`, format `schemaVersion: 1`, its `id`, an array
of `parents`, and the complete `projects` array. Project document schema versions
are separate from the folder format version. The normal portable library export
remains available.

No existing revision or shared manifest is overwritten. Native writable streams
commit on close; Pocketry reads the file back and verifies the exact bytes before
reporting success. A zero-length newly created file is an unfinished write and
does not count as a revision. Nonempty invalid/newer revisions, missing parents,
cycles, and revoked permissions fail closed and retain all files.

Before each mutation the current directory heads must equal the session's last
observed heads. A stale session cannot silently replace external work. Two
writers that both pass this check may still race; their unique revisions both
survive and become divergent heads. A post-write check catches visible races,
and subsequent reads, saves, focus, or reload detect races that completed later.
This provides preservation and detection, not a cross-browser exclusive lock.
Web Locks cannot coordinate independent browsers/profiles, so correctness does
not depend on them.

**Keep both versions** explicitly unions current heads and the editor's pending
document. Identical versions are deduplicated; different versions of an ID or
name get independent IDs and conflict suffixes. A deletion on one concurrent
branch may reappear from another branch so no surviving version is discarded.
The merged revision names every observed head as a parent. Further races retain
their own head and require another resolution. The current editor becomes a
draft, preventing it from automatically overwriting the chosen retained version.

## Recovery and limits

On failure, export the current project. Pending folder autosaves also make a
best-effort browser recovery copy, which is not reported as a completed folder
save. Reconnect after permission loss. Unreadable browser library envelopes
produce a visible error and a raw recovery download instead of an empty library.
Raw recovery downloads are for diagnosis/restoration, not normal library import.

Every changed folder save retains a complete snapshot. Storage usage and
directory-read cost therefore grow with editing; automatic compaction/pruning is
not part of this initial format. Keep the revision directory intact. To start a
smaller library, export the current library, retain the old folder as an archive,
connect a new empty folder, and import the export. Do not manually remove parent
revisions from an active folder. Filesystem or cloud-drive synchronization tools
can expose incomplete copies; use a local folder and let synchronization finish
before reconnecting elsewhere. Live cross-device synchronization is not promised.

An intact older revision can be recovered by copying its `projects` array into
the existing portable envelope `{ "format": "pocketry-library", "schemaVersion":
1, "projects": [...] }` and importing that into a separate library. Preserve the
original directory before manual repair. No code automatically deletes revision
files or replaces data that it cannot parse.

## Verification

Automated coverage exercises independent sessions, simultaneous writes past the
pre-write check, stale reloads, pending-edit recovery, interrupted writes,
permission renewal, missing/corrupt/newer revision data, legacy document
migrations, history preservation, and reconnection after clearing browser data.
Native Chrome/Edge permission dialogs and filesystem behavior also require
browser qualification; an in-memory API model alone is not that evidence.
