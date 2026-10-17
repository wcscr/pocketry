# Self-hosting Pocketry

Pocketry runs in your browser. Use [Docker](#with-docker) for the packaged static
server, or [host without Docker](#without-docker) using Node or an existing static
web host. All options keep designs in each browser; there is no account system,
upload API, database, shared library, or server-side project storage.

## With Docker

The container serves the built app with Nginx. Node and Vite are build tools only.

Install Docker Engine/Desktop with Docker Compose, then clone the repository:

```sh
git clone https://github.com/wcscr/pocketry.git
cd pocketry
docker compose up -d --build
```

Open **http://localhost:8080**. The first build downloads the pinned base images
and npm dependencies. No separate Node installation is needed. This setup builds
an image locally; it does not pull a published Pocketry image.

The default port is accessible only on the Docker host. To choose another port:

```sh
POCKETRY_PORT=8081 docker compose up -d --build
```

Use that same setting for subsequent starts. `docker compose logs --tail=50`
shows startup errors; `docker compose down` stops and removes the container.

## Without Docker

Install Node.js 22 and npm, then build from a repository checkout:

```sh
git clone https://github.com/wcscr/pocketry.git
cd pocketry
npm ci
npm run build
npm start
```

Open **http://localhost:5000**. `npm start` runs the production static-file server;
`PORT=8080 npm start` selects another port on macOS/Linux. It listens on **all
host interfaces**, unlike the Docker example's loopback binding. Use a firewall
and HTTPS reverse proxy for deliberate remote hosting. Keep the checkout,
`node_modules`, and `dist` together, and use your operating system's service manager
if it should keep running after logout. Do not use `npm run dev` or `vite preview`
for production hosting.

Alternatively, copy the **contents of `dist/public`** to an existing static web
host. Node is then needed only for building. Serve the app at a hostname's root,
route app URLs such as `/bin` to `index.html`, return 404 for `/api` and missing
assets, and serve JavaScript/CSS/WebAssembly with their correct MIME types
(`application/wasm` for `.wasm`). Keep `LICENSE.txt` and `NOTICE.txt` with the app.
Revalidate HTML and unversioned files after updates; only hashed `/assets/` files
should have long-lived immutable caching. [Our Nginx configuration](../deploy/nginx.conf)
is a reference for these rules; adapt it to your host rather than replacing an
existing server's global configuration.

For upgrades, export backups, stop the Node service if used, run
`git pull --ff-only`, `npm ci`, and `npm run build`, then restart the service or
replace the static host's files. Reload the browser and keep the same address.

## Where designs are saved

Projects, library entries, and Trace recovery data are stored **in the browser**,
primarily in IndexedDB. The hosting server stores none of them. There is no shared
library or automatic synchronization between users, browsers, or devices.

Browser storage belongs to an **origin**: the exact scheme, hostname, and port.
`http://localhost:8080`, `http://127.0.0.1:8080`, another port, and an HTTPS domain
all have separate storage. Choose one address and keep using it. A new address
may show an empty library even though the old address still has your projects.
Export backups at the old address and import them at the new one before moving.
The public Pocketry site and your self-hosted site also have separate storage.

Clearing site data, deleting a browser profile, private-browsing sessions, or
browser storage eviction can lose designs. Container backups, Docker volumes,
and server disk snapshots **do not back up browser projects**. Recreating the
container does not itself clear browser storage, but it is not a backup strategy.

## Back up and restore

Import opens the browser's file picker on **your device**, and export downloads
files to your browser's download location (or asks where to save, depending on
browser settings). This works even when Docker runs on another computer. No host
folder mount or server write permission is needed; the selected project is read
by the browser, not uploaded to the container.

1. In Bin, use **Project → Export project** for an editable `.pocketry.json`
   backup of the current design. Do this separately for an unnamed draft.
2. Open **Library → Export library** to download all named projects. An unnamed
   draft is not included; save it to Library first or export it separately.
3. Keep the downloaded files somewhere backed up, such as your normal document
   backup location. STL, 3MF, SVG, and DXF exports are useful outputs but do not
   replace the editable Pocketry backup.
4. To restore or move to another browser/address, open Pocketry there and use
   **Import Project** for a project file, or **Library → Import library** for a
   library backup. Confirm the restored design before deleting the original.

The Trace workspace's automatic recovery copy is browser-local too. In Trace's export dialog, select
**Also download editable project (.pocketry.json)** to keep an editable outline.
That outline backup does not preserve the complete Trace workspace or original
photo; retain the photo separately. An unnamed Trace draft is not included in a
library export.

## Docker upgrades

Export project/library backups first. In a clean checkout, update the source and
rebuild, then reload the browser page:

```sh
git pull --ff-only
docker compose up -d --build
```

Keep the same address and browser profile. If a previous release must be restored,
use a separate checkout of that release and rebuild; saved-project compatibility
with older versions is not guaranteed. Keep pre-upgrade backups.

Base images are pinned to multi-platform digests in `Dockerfile`. The runtime
uses the slim Nginx image and updates zlib from Alpine's package repository at
build time, so its exact package version can advance between rebuilds. Pulling
alone does not advance the base-image pins; maintainers must update the
version/digest, rebuild, and scan when base-image security updates are available.
This repository does not publish images or run hosted CI as part of this setup.

## Other devices and HTTPS

For access beyond this computer, use a dedicated HTTPS hostname and a reverse
proxy in front of the chosen server port (8080 for Docker, 5000 for Node by default). A proxy on the Docker host can reach the default
loopback binding; a proxy in another container needs a shared Docker network or
an explicitly reachable host address. The app is built for the hostname's root
path, not a subpath such as `/pocketry/`.

If you deliberately want direct LAN access, change the Compose port mapping to
`"8080:8080"`; this exposes it on all host interfaces, subject to your firewall.
Use HTTPS for remote access so browser features requiring a secure context work.
The included image does not configure TLS or authentication. Put access controls
at your reverse proxy if needed. Each visitor still has their own browser-local
projects, even when everyone uses the same server.

## Container behavior and local verification

The runtime runs as the unprivileged `nginx` user on port 8080. Compose makes its
filesystem read-only, supplies a small temporary filesystem, drops capabilities,
and prevents privilege escalation. Only compiled assets and public/legal files
are copied from the build stage. `/api` requests return 404; direct links to
`/bin` and other app routes load the app. HTML and unversioned assets revalidate;
hashed assets can be cached across page loads.

After starting the container, maintainers can run the HTTP smoke test with Node 22 and dependencies installed (`npm ci`):

```sh
npx tsx scripts/test-self-hosting.ts http://localhost:8080
```

It checks app routes, API rejection, missing assets, cache headers, JavaScript,
OpenCV, WebAssembly, and legal notices. Also open Trace and Bin in a browser to
check the 3D preview. Repository checks remain local: `npm run check`, `npm test`,
and `npm run build`.
