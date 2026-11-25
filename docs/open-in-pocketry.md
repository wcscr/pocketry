# Open in Pocketry links

An Open in Pocketry link opens an editable copy of a project export, or one
project from a library export, in Bin:

```text
https://pocketry.xyz/bin#source=ENCODED_FILE_URL&project=PROJECT_ID
```

`source` is the URL-encoded address of a Pocketry JSON file. Use the fragment
format above to keep the file URL out of the request to the Pocketry website.
The `?source=…` format also works for ordinary public file URLs with no query
parameters or fragment. A Drive link with only the standard `usp` parameter is
also accepted in that format.

For a direct HTTPS URL, use the address that serves the file without redirecting.
The host must allow a browser at `pocketry.xyz` to fetch it (CORS). Google Drive
and GitHub raw file links start loading automatically. For other hosts, Pocketry
shows the destination and asks the recipient to confirm the download.

On sites with Drive enabled, you can also use a standard Google Drive file share
URL (`https://drive.google.com/file/d/FILE_ID/view`). Set the file to
**Anyone with the link** and allow viewers to download it. Encode the full
share URL, including its resource key if present, and use the `#source=…` format.
Use the link to the JSON file itself, since a folder link does not identify a file.

For a standalone `.pocketry.json` project, omit `project`. For a library export,
`project` must exactly match one of its exported `projects[].id` values. That ID
controls **which design opens**. Omit `project` from a library link to let the
recipient choose from a picker. An unknown ID shows an error and leaves the
current design in place.

After this version is deployed, these examples use versioned, public sample files:

- [Open a standalone Mini Socket Set project](https://pocketry.xyz/bin#source=https%3A%2F%2Fraw.githubusercontent.com%2Fwcscr%2Fpocketry%2F7731753d%2Fsamples%2Fmini-socket-set%2Fmini-socket-set.pocketry.json)
- [Open Mini Socket Set from the sample library](https://pocketry.xyz/bin#source=https%3A%2F%2Fraw.githubusercontent.com%2Fwcscr%2Fpocketry%2F7731753d%2Fsamples%2Fpocketry-sample-library.json&project=pocketry-sample-mini-socket-set)
- [Choose a design from the sample library](https://pocketry.xyz/bin#source=https%3A%2F%2Fraw.githubusercontent.com%2Fwcscr%2Fpocketry%2F7731753d%2Fsamples%2Fpocketry-sample-library.json)

Opening one design leaves the recipient's saved library intact. Pocketry checks
for unsaved work before replacing the current editor design. The recipient can
edit and save the copy through the usual controls.

**Project selection does not restrict access to the source file.** Anyone with
the library URL can fetch the whole library JSON and all its projects. To share
only one design, export and host a standalone project file instead.

## Enable Drive links on the deployed site

Enable the Google Drive API in your Google Cloud project and create a standard
API key. Restrict it to the Google Drive API and to the website referrers
where Pocketry will run. For Pocketry production, allow
`https://pocketry.xyz/*`.

Set `VITE_GOOGLE_DRIVE_API_KEY` in the environment that runs `npm run build`.
For Cloudflare Pages Git builds, add it to the **Production** environment
variables of the Pocketry Pages project as a **Secret** before building the
production branch. This hides the stored value in the dashboard.
For local verification, put it in the ignored `client/.env.local` and allow
the local origin in Google Cloud. Vite places the value in the browser bundle,
so use a restricted browser key and keep the value out of source control.
