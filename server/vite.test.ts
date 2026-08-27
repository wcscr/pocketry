import express, { type Express } from "express";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { serveLegalFiles } from "./vite";

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;

  await new Promise<void>((resolve, reject) => {
    server?.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  server = undefined;
});

async function listen(app: Express): Promise<string> {
  server = await new Promise<Server>((resolve, reject) => {
    const listeningServer = app.listen(0, "127.0.0.1", () => {
      resolve(listeningServer);
    });
    listeningServer.once("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected the legal-file test server to use a TCP port");
  }

  return `http://127.0.0.1:${address.port}`;
}

describe("serveLegalFiles", () => {
  it.each([
    ["LICENSE.txt", "GNU AFFERO GENERAL PUBLIC LICENSE"],
    ["NOTICE.txt", "Copyright (c) 2026 Sugarcreek Research, LLC"],
  ])("serves %s as plain text", async (fileName, expectedText) => {
    const app = express();
    serveLegalFiles(app);
    const baseUrl = await listen(app);

    const response = await fetch(`${baseUrl}/${fileName}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(
      /^text\/plain; charset=utf-8$/,
    );
    expect(await response.text()).toContain(expectedText);
  });
});
