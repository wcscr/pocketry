import type { Express } from "express";
import { createServer } from "http";
import { storage } from "./storage";
import { insertImageSchema } from "@shared/schema";
import { randomUUID } from "crypto";

export async function registerRoutes(app: Express) {
  // Add session management
  app.use((req, res, next) => {
    if (!req.headers["x-session-id"]) {
      req.headers["x-session-id"] = randomUUID();
    }
    next();
  });

  app.post("/api/images", async (req, res) => {
    try {
      const sessionId = req.headers["x-session-id"] as string;
      const imageData = insertImageSchema.parse({
        ...req.body,
        sessionId,
      });
      const savedImage = await storage.saveImage(imageData);
      res.json(savedImage);
    } catch (error) {
      res.status(400).json({ message: "Invalid image data" });
    }
  });

  app.get("/api/images/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid image ID" });
    }

    const image = await storage.getImage(id);
    if (!image) {
      return res.status(404).json({ message: "Image not found" });
    }

    res.json(image);
  });

  app.get("/api/images", async (req, res) => {
    const sessionId = req.headers["x-session-id"] as string;
    const images = await storage.getImagesBySession(sessionId);
    res.json(images);
  });

  return createServer(app);
}