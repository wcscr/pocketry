# Local Pocketry automation

Use the CLI or an MCP host to work with completed revisions in a
[connected project folder](library-folder.md). Drafts and pending autosaves
remain in the editor. The process operator selects the library root before
starting the tool.

## Setup

From a checkout with Node.js 26, run `npm ci` and `npm run build:automation`.
In Pocketry, enable experimental features in **App settings**. Open **Library → Settings → Local folder**, choose a folder, and save a named project.
Pass the absolute path to the resulting `pocketry-library` subdirectory.

```sh
node dist/automation/cli.js --library "/path/to/pocketry-library" capabilities </dev/null
printf '%s\n' '{"limit":10}' |
  node dist/automation/cli.js --library "/path/to/pocketry-library" list_projects
```

The CLI reads one JSON arguments object from stdin, treats EOF without input
as `{}`, and writes one JSON response to stdout. A command error returns
`{"ok":false,"error":{"code":"validation","message":"Invalid command arguments."}}`
with a nonzero exit status. Errors can also include an edit index, expected
and current heads, or validation findings. A successful command can return
an uncertain or conflicting publication outcome. Check the outcome status
before attempting another mutation.

Keep the installed `node_modules` alongside the build. The worker resolves
`manifold-3d/manifold.wasm` from that package and bundles the same Three.js
typeface data as the editor. Project backups carry supported embedded font
sources and glyphs, so saved labels do not depend on fonts installed on the
machine running the CLI. When distributing a build, include the repository
license, [NOTICE](../NOTICE), the typeface notices in
`client/public/licenses/`, and the applicable npm dependency notices.
`npm run build` also generates the browser distribution’s consolidated
`dist/public/NOTICE.txt`.

## MCP over stdio

Add a local MCP server using an absolute Node 26 executable and CLI path,
adjusting the example for your host’s configuration format.

```json
{
  "mcpServers": {
    "pocketry": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/pocketry/dist/automation/cli.js",
        "--library",
        "/absolute/path/to/pocketry-library",
        "mcp"
      ]
    }
  }
}
```

The server implements MCP [2025-11-25 initialization](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle),
[stdio framing](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#stdio),
and [tool listing and calling](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
It uses a small stdio adapter with the existing Zod schemas and no extra SDK
dependency. Configure newer hosts to negotiate the handshake-era protocol.
The server writes JSON-RPC to stdout and diagnostics to stderr. Tool responses
include structured content and a text representation for hosts that display
text.

Example tool call after initialization.

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_projects","arguments":{"limit":10}}}
```

Example structured content for an empty folder.

```json
{"ok":true,"result":{"projects":[],"nextAfter":null}}
```

## Command surface

| Command | Effect |
| --- | --- |
| `capabilities` | API, folder and project versions, supported edits, export formats, and limits |
| `list_projects` | Compact summaries in project-ID order. Pass `nextAfter` back as `after`. |
| `read_project` | Saved summary with optional pinned `revision`. Choose `detail: "geometry"` or `"history"` explicitly. |
| `validate_project` | Document and layout findings without building solids |
| `apply_edits` | Preview a batch against a pinned revision and return validation findings |
| `create_project` | Commit a new named Gridfinity project |
| `import_project` | Commit an editable backup as a named project, preserving the design’s internal object IDs |
| `copy_project` | Copy a pinned source with fresh project identity. Apply optional edits before publishing the copy. |
| `commit_project` | Apply a batch to an existing project with its expected head token |
| `inspect_request` | Retrieve durable publication evidence after a lost reply. Optionally pass the candidate `revision` when the full folder scan fails. |
| `keep_both` | Choose a version for the original ID and copy other live heads, given every expected head |
| `export_revision` | Save STL, 3MF, multicolor 3MF, Bambu 3MF, Prusa 3MF, or an editable backup from a pinned revision |

Mutations take a library-scoped `requestId`. Create, import, and copy require
`expectedBase: null` for the new identity. For an existing project,
`commit_project` requires `expectedBase` equal to its saved revision token.
Copy also takes the source `projectId` and `revision`, which deliberately
pin the source even if later edits have been saved. Inspect a lost reply
before retrying with the same ID and arguments. The
[folder publication contract](library-folder.md#publication-and-recovery)
defines the status fields and concurrent reuse behavior.

A batch contains at most 16 semantic edits. It preserves pocket and finger
placement, dimensions, footprints, and internal IDs. Compartment changes
use the same label-tab attachment behavior as the editor. A successful
batch that changes the design adds one undo step and truncates the redo
tail, as an editor change would. A rejected batch publishes nothing.

| Edit | Supported settings |
| --- | --- |
| `set_compartments` | Hollow bins. Update `enabled`, `rows`, `columns`, `dividerThicknessMm`, or `scoop`. Rows run from front to back, columns left to right. Both counts range from 1 to 32. Enabling an otherwise unused grid without counts starts with two rows, as in the editor. Divider thickness ranges from 0.95 to 3 mm under the schema, with layout validation enforcing clear span. |
| `set_pocket_clearance` | Set the existing `pocketId` clearance in millimeters per side, from -5 to +5. Positive offsets expand the opening. Existing linked-design restrictions apply. |
| `set_label_text` | Change up to 120 characters for an existing `labelId`. Keep the font, symbol, rotation, and attachment. The font must provide the requested glyphs. |
| `set_materials` | Set the body, floor, rim, or label-background color and enable or disable existing color regions. Colors are six-digit hex strings. |

Dimensions and positions are in millimeters, with rightward positive X,
backward positive Y, and upward positive Z in bin space. Coordinates are
relative to the footprint center. Grid body height units are 7 mm. The
current edit commands do not accept custom positions.

An imported or copied backup without edits can retain a structurally valid
work-in-progress design with layout errors. The response reports findings.
Automated edits require a layout without errors before publication. Exact
geometry checks and serialization happen at export. Exports can still fail
after a cheap validation passes. Each successful export returns a generated
local path, size, digest, and exact input revision. Exporting twice can
create two artifacts. It does not create another project revision.

The CLI accepts 65 MiB of JSON input. MCP accepts 8 MiB per newline-delimited
message and one active tool call per server. Explicit read detail is capped at
4 MiB. Automated layout checks cap placed objects and labels at 256. Model
exports run in a worker with a two-minute timer and a 512 MiB JavaScript
old-generation limit. WASM and external buffers are outside that heap cap.
Model artifacts are limited to 192 MiB. Editable backups use the editor’s
64 MiB import limit. Cancellation before a write can stop it,
and the MCP server can terminate geometry before artifact publication. Once
a publication starts, cancellation cannot roll it back. Inspect the request
after cancellation or process failure.

## Example from browser save to export

Save a hollow bin in the connected folder as **Socket tray**. In a shell
with `jq`, point `library` to the connected subdirectory. This example takes
the bin’s saved document, changes the compartment columns, and publishes the
edited copy once.

```sh
library="/path/to/pocketry-library"
pocketry() { node dist/automation/cli.js --library "$library" "$1"; }

source=$(pocketry list_projects </dev/null | jq -ec '
  .result.projects[] | select(.conflicted == false) |
  select(.heads[0].name == "Socket tray") |
  {projectId, revision: .heads[0].revision}')
request=$(node -p 'crypto.randomUUID()')
edits='[{"type":"set_compartments","settings":{"enabled":true,"columns":3}}]'

printf '%s\n' "$source" | jq --argjson edits "$edits" '. + {edits:$edits}' |
  pocketry apply_edits

copy=$(printf '%s\n' "$source" |
  jq --arg request "$request" --argjson edits "$edits" '
    . + {requestId:$request, expectedBase:null, name:"Socket tray with three columns", edits:$edits}' |
  pocketry copy_project)
printf '%s\n' "$copy" | jq '.result.outcome | {status,requestId,publications}'

pinned=$(printf '%s\n' "$copy" | jq -ec '
  .result.outcome | select(.status == "published") |
  .publications[0] | {projectId:.projectIds[0], revision, format:"3mf"}')
printf '%s\n' "$pinned" | pocketry export_revision | jq '.result.artifact'
```

In Pocketry, refresh the connected folder and open **Socket tray with three
columns**. The copy has its own project ID, the original layout, the revised
compartment setting, and one new undo step. Use `inspect_request` with
`$request` if the copy reply is lost.
