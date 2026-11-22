# Connected project folders

In Bin, open **Projects → Connected folder → Connect folder**, then choose a
local folder. Pocketry creates a `pocketry-library` directory inside it.
Enter a name and choose **Save as new folder project**. Open a saved revision
from the folder list to continue editing it. **Save folder revision** commits
the current editor state against the revision you opened or last saved. The
browser library, backups, and editor autosaves work independently of this
connection. The folder requires neither an account nor a network service.

A completed folder save is a named snapshot. Pointer gestures and uncommitted
fields need to be finished before opening the dialog to save them. The save
uses the editor’s committed design and undo history as shown at that point.
Page hiding and navigation can flush the normal browser autosave. A Node
reader sees the saved folder revision and cannot inspect editor state, its
pending autosave, or an unnamed draft.

**Refresh** rereads the folder without changing the open editor. To see an
assistant’s edit, select the project and open the new revision. Opening a
folder revision makes a browser-local working draft and binds the next explicit
folder save to the opened revision for that editor visit. Reloading restores
the browser working draft. Open the desired folder revision again to establish
a new base, or save the working draft as a new folder project. Switching to
another project or disconnecting clears the current folder save target.

Each browser and profile grants its own permission. Choose **Renew access**
when prompted. If the browser keeps file editing blocked, grant it in site
settings or choose the same folder again. You can also disconnect and continue
in the browser library. Clearing
site data removes the saved handle, recovery requests, and browser-local work.
The completed folder revisions remain on disk and reappear on reconnection.
**Copy saved browser projects** copies up to 100 readable named projects in one
operation, preserving IDs and source data. It skips IDs already present and
documents that require recovery or a newer version. Use the browser backup
before repairing a corrupt or unreadable browser library.

## Version 2 on disk

The root is the actual `pocketry-library` directory. Managed files are named
`pocketry-r2-<request-key>-<revision>.json` with lowercase hexadecimal SHA-256
digests. `request-key` hashes the UTF-8 request ID. `revision` hashes the exact
UTF-8 file bytes. A version 2 file has these strict fields.

| Field | Value |
| --- | --- |
| `format` | `pocketry-folder-revision` |
| `version` | `2` |
| `requestId` | Caller-assigned ID, scoped to this folder |
| `fingerprint` | SHA-256 of canonical typed input, including expected bases |
| `changes` | Up to 100 distinct project snapshots |

Each change contains `projectId`, `parents`, `name`, and `doc`. A new project
has no parents. Updates reference that project's expected heads. A null
document is a deletion marker, and the prior versions remain readable by
revision. An independent project keeps its own timeline. A multi-project
publication has one token shared by all of its changes. Project documents use
Pocketry's existing schema, migrations, embedded font sources, and serializer.
File modification time is display metadata. Sorted object keys and meaningful
array order define the canonical JSON used when this implementation writes.

This schema is independent of the portable library backup format. Version 1
of draft PR #145 stored complete snapshots in UUID-named files. Version 2
refuses to write beside those files. Keep that directory as an archive, choose
the version 1 revision you want to recover, and copy its `projects` array into
a portable `{"format":"pocketry-library","schemaVersion":1,"projects":[…]}`
backup. Import it in the browser, then copy the saved projects into a new
folder. Review divergent version 1 heads separately. Automatic downgrade
and conversion of draft history are outside version 2.

## Publication and recovery

Writers check the request ID and explicitly supplied project bases before
publishing. Node stages and syncs a temporary file before renaming it in the
same directory. Chrome and Edge publish the writable stream on close. An
interrupted browser create can leave an empty entry. Readers report it as
pending for the associated request and ignore it as a project revision.

The revision is the operation record. It contains the request ID, input
fingerprint, and resulting projects. The same deterministic intent produces the
same bytes, filename, and creation IDs. Concurrent identical requests publish
one logical revision even if both filesystem calls run. After a lost reply or
restart, inspect the request ID and retry only with the same input and bases.
When a candidate revision token is known, a targeted inspection can confirm
its publication even if an otherwise unreadable folder prevents checking its
heads. The browser stores the pending intent before writing and offers **Check and
resume** before further folder saves. If the post-publication check or browser metadata cleanup fails, the
folder record can still establish what happened. Stale-base and input
validation errors occur before that attempt publishes.

| Outcome | Interpretation |
| --- | --- |
| `published` | A complete matching revision was observed. Project heads describe that scan. |
| `published-conflict` | Published work and competing revisions were observed. Inspect the project heads or explicit revisions. |
| `published-unverified` | The filesystem acknowledged the write and the subsequent check could not establish the full outcome. |
| `uncertain` | The filesystem did not confirm the write and readback could not establish publication. |
| `pending` | An empty candidate is visible. Resume with the same intent, or retain the file until a maintainer can inspect it. |
| `not-found` | No record was visible in this scan. Another process may still be writing. |

A request ID already visible with different input is rejected. If different
inputs reuse an ID simultaneously before either can observe the other, both
publications can become visible. The result flags the request collision and retains both publications. Use a new ID for explicit recovery. Independent concurrent
updates to one base similarly become separate project heads. A successful
reply reports what was visible at that moment and can precede discovery of a
later race. The protocol provides neither atomic compare-and-swap nor a lock
across browser profiles and Node. It cannot make guarantees about persistence
after media failure, deliberate folder modification, or sync software that
reorders, rolls back, or drops files.

Open either side of a conflict by its revision. **Keep this as original**
explicitly keeps the selected version under its original ID, copies each
other live head under a new ID, and records both in one publication. The
recovery returns all affected IDs. If a stale editor has changes that were
never published, save them as a new project or download a project backup.
The conflict tools copy snapshots without combining CAD edits.

## Limits and confinement

A scan enumerates up to 10,000 directory entries, 2,000 revision files, and
256 MiB of revision payload. Each revision is at most 128 MiB. Each project
is at most 64 MiB and subject to [the existing import guards](../shared/gridfinity/import-limits.ts)
on schema, history, geometry, placements, and embedded fonts. The graph
allows 32 parents per change and 1,000 parent levels. Scans validate the
envelope and hashes, and retain only graph metadata. Opening a document runs
the project import guards and migrations on that snapshot. A mutation scans
before and after publication. Concurrent arrivals can cross a limit that
each writer passed individually, so keep headroom when approaching a cap.

Empty entries are preserved. Nonempty corrupt revision files, unknown folder
versions, bad parent graphs, and unreadable or future project documents
produce a recovery error. Copy the folder before attempting repair. Keep all
required ancestors. To start a smaller library, export or copy the current
project snapshots into a new folder and retain the entire old folder as its
archive. There is no automatic pruning.

The Node operator supplies an absolute root path, which is resolved once.
Tool arguments carry project IDs and hashes, never revision filenames or
filesystem paths. The adapter joins only managed single basenames, rejects
symlinks, hard links and nonregular revision entries, and checks that the
root still resolves to the originally connected directory. The folder and its
parent directories must remain under the operator’s control during use.
Browser access follows the user-granted directory handle and Chromium’s
filesystem permission model. The content hashes detect accidental changes,
while a writer with direct folder access can create new, internally valid
files or remove old ones.

## Scan costs

Run `node --import tsx scripts/measure-library-folder.ts 12` from a checkout
to measure a directory with the 17 checked-in sample designs, 40 folder
revisions per design, and 12 retained editor-history entries per snapshot.
On the qualification Mac with Node 26.13.1, the 680-revision, 20.5 MiB fixture
took 1.62 seconds on the first list. Median cached-filesystem times from the
following four runs were about 189 ms to list, 185 ms to read one project,
and 405 ms for a checked save. These are Node filesystem timings.
The journal keeps snapshots for changed projects and reads revision files
for each scan. It is suited to named saves and batched changes within the
documented limits.

## Native browser qualification

Use a disposable test folder and browser profile. Connect its parent in
Chrome, save a named project, commit a copy or edit with the Node CLI, then
refresh and reopen the exact revision. In Edge, select the same parent and
reopen that revision. Compare the layout, label wording, materials, and
undo history. Revoke file editing for the test origin, reload, and attempt
**Renew access**. If that browser retains the block, choose the folder again.

Close a disposable private profile or clear site data for the isolated test
origin, then reconnect and confirm the named revisions remain. For interruption
testing, stop a disposable browser session during a write and separately just
after a successful close. Inspect the request from Node before retrying.
An empty candidate can be resumed using the same input. A complete candidate
must match the revision digest and must resolve the original request.
