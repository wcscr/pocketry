import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = createApp();
  // Model both Vite and production SPA fallbacks, which run after the app factory.
  app.use((_req, res) => res.type("html").send("<html>Pocketry editor</html>"));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
});

describe("retired image API", () => {
  it.each(["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"])(
    "rejects %s collection and detail requests before SPA fallback", async method => {
      for (const path of ["/api/images", "/api/images/1", "/API/IMAGES/", "/api/%69mages/%31?raw=1", "/api//images", "/api/images/%ZZ"]) {
        const response = await fetch(baseUrl + path, {
          method,
          headers: { "X-Session-ID": "another-session" },
        });
        expect(response.status, `${method} ${path}`).toBe(404);
        expect(response.headers.get("content-type")).not.toContain("application/json");
        expect(await response.text()).not.toContain("Pocketry editor");
      }
    },
  );

  it.each(["application/json", "application/x-www-form-urlencoded"])(
    "rejects %s uploads without parsing or retaining the body", async contentType => {
      const response = await fetch(`${baseUrl}/api/images`, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: "{ deliberately malformed JSON and no image schema",
      });
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not Found");
      const list = await fetch(`${baseUrl}/api/images`);
      expect(list.status).toBe(404);
    },
  );

  it("preserves editor deep links", async () => {
    const response = await fetch(`${baseUrl}/bin`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Pocketry editor");
  });
});
