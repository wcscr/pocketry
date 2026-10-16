import express from "express";

/** Pocketry serves a browser-local editor; the retired API must not hit SPA fallback. */
export function createApp() {
  const app = express();
  app.use("/api", (_req, res) => {
    res.sendStatus(404);
  });
  return app;
}
