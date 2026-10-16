import express from "express";
import { createServer, request, type Server } from "node:http";
import { writeFile, rm } from "node:fs/promises";
import path from "node:path";
import type { ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupVite } from "./vite";

let server: Server;
let vite: ViteDevServer;
let baseUrl: string;
const root = path.resolve(import.meta.dirname, "..");
const canary = path.join(root, `.security-canary-${process.pid}.txt`);
const secret = "not-a-public-pocketry-asset";

beforeAll(async () => {
  await writeFile(canary, secret);
  const app = express();
  server = createServer(app);
  vite = await setupVite(app, server);
  // Exercise explicit requests without pre-transforming the entire editor import graph.
  vite.config.server.preTransformRequests = false;
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 30_000);

afterAll(async () => {
  await vite?.waitForRequestsIdle();
  server?.closeAllConnections();
  await vite?.close();
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
  await rm(canary, { force: true });
}, 30_000);

describe("development security boundary", () => {
  it.each(["attacker.example", "localhost.attacker.example"])(
    "rejects untrusted Host %s, including with forged forwarding headers", async host => {
      const response = await new Promise<{status: number | undefined; body: string}>((resolve, reject) => {
        const req = request(`${baseUrl}/src/main.tsx`, {
          headers: { Host: host, "X-Forwarded-Host": "localhost" },
        }, res => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", chunk => { body += chunk; });
          res.on("end", () => resolve({ status: res.statusCode, body }));
        });
        req.on("error", reject);
        req.end();
      });
      expect(response.status).toBe(403);
      expect(response.body).not.toContain("createRoot");
    },
  );

  it("rejects an untrusted Host on the HMR upgrade path", async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(baseUrl, {
        headers: {
          Host: "attacker.example",
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Protocol": "vite-hmr",
        },
      });
      req.on("response", res => { res.resume(); resolve(res.statusCode); });
      req.on("upgrade", (_res, socket) => { socket.destroy(); reject(new Error("Untrusted upgrade accepted")); });
      req.on("error", reject);
      req.setTimeout(5000, () => req.destroy(new Error("Upgrade timed out")));
      req.end();
    });
    expect([400, 403]).toContain(status);
  });

  it.each(["/__open-in-editor", "/__OPEN-IN-EDITOR/", "/__open-in-editor.json"])(
    "disables editor-launch endpoint %s", async route => {
      const response = await fetch(`${baseUrl}${route}?file=${encodeURIComponent(canary)}`);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not Found");
    },
  );

  it("also disables editor launching for absolute-form request targets", async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(baseUrl, {
        path: `${baseUrl}/__open-in-editor.json?file=${encodeURIComponent(canary)}`,
      }, res => { res.resume(); resolve(res.statusCode); });
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(404);
  });

  it.each(["", "?raw", "?url"])(
    "does not serve repository-root files through /@fs/ with %s", async query => {
      const response = await fetch(`${baseUrl}/@fs/${canary}${query}`);
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain(secret);
    },
  );

  it("does not disclose contents through an asset import wrapper", async () => {
    const response = await fetch(`${baseUrl}/@fs/${canary}?import`);
    const body = await response.text();
    expect(body).not.toContain(secret);
    if (response.status === 200) {
      // Vite may return a module exporting the URL, but that URL must still be denied.
      const assetUrl = body.match(/export default "([^";]+)"/)?.[1];
      expect(assetUrl).toBeDefined();
      const asset = await fetch(new URL(assetUrl!, baseUrl));
      expect(asset.status).toBe(403);
      expect(await asset.text()).not.toContain(secret);
    } else {
      expect(response.status).toBe(403);
    }
  });

  it("serves the geometry kernel WASM", async () => {
    const response = await fetch(`${baseUrl}/@fs/${root}/node_modules/manifold-3d/manifold.wasm`);
    expect(response.status).toBe(200);
    expect([...new Uint8Array(await response.arrayBuffer()).slice(0, 4)]).toEqual([0, 97, 115, 109]);
  });

  it("retains the allowlist in Express middleware mode", () => {
    expect(vite.config.server.allowedHosts).not.toBe(true);
    expect(vite.config.server.fs.strict).toBe(true);
    expect(vite.config.server.fs.allow).not.toContain(root);
    for (const dir of ["client", "shared", "node_modules"]) {
      expect(vite.config.server.fs.allow).toContain(path.join(root, dir));
    }
  });

  it.each([
    ["/", "<html"],
    ["/bin", "<html"],
    ["/src/main.tsx", "createRoot"],
    ["/src/pages/about.tsx", "package.json"],
    [`/@fs/${root}/package.json?import`, "rest-express"],
    ["/@vite/client", "WebSocket"],
    [`/@fs/${root}/shared/gridfinity/types.ts`, "binSpecSchema"],
    ["/src/lib/gridfinity/bin.worker.ts?worker_file&type=module", "createBinWorkerHandlers"],
    ["/src/lib/manifold/runtime.ts", "manifold"],
    ["/LICENSE.txt", "GNU AFFERO"],
    ["/NOTICE.txt", "Sugarcreek Research"],
  ])("preserves legitimate development resource %s", async (route, content) => {
    const response = await fetch(baseUrl + route);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(content);
  });
});
