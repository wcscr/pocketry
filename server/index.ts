import type { Request, Response, NextFunction } from "express";
import { createServer } from "node:http";
import { createApp } from "./app";
import { setupVite, serveStatic, log } from "./vite";

const app = createApp();

(async () => {
  const server = createServer(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    log(`Error: ${err.message}`);
    res.status(status).json({ message });
  });

  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // PORT override matters on macOS, where AirPlay Receiver squats on 5000.
  // No `reusePort`: it is a Linux-only listen option (SO_REUSEPORT) that makes
  // macOS fail with ENOTSUP, and nothing here needs it.
  const port = Number(process.env.PORT) || 5000;
  const host = app.get("env") === "development" ? "127.0.0.1" : "0.0.0.0";
  server.listen({ port, host }, () => {
    log(`serving on port ${port}`);
  });
})();
