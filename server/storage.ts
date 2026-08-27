import { images, type Image, type InsertImage } from "@shared/schema";

export interface IStorage {
  saveImage(image: InsertImage): Promise<Image>;
  getImage(id: number): Promise<Image | undefined>;
  getImagesBySession(sessionId: string): Promise<Image[]>;
}

export class MemStorage implements IStorage {
  private images: Map<number, Image>;
  private currentId: number;
  private sessionImages: Map<string, Set<number>>;

  constructor() {
    this.images = new Map();
    this.currentId = 1;
    this.sessionImages = new Map();
  }

  async saveImage(insertImage: InsertImage): Promise<Image> {
    const id = this.currentId++;
    // `metadata` is optional on insert but non-optional (nullable) on the
    // selected row, so normalise `undefined` to `null` to match the DB shape.
    const image: Image = {
      id,
      ...insertImage,
      metadata: insertImage.metadata ?? null,
    };
    this.images.set(id, image);

    // Track images by session
    if (!this.sessionImages.has(insertImage.sessionId)) {
      this.sessionImages.set(insertImage.sessionId, new Set());
    }
    this.sessionImages.get(insertImage.sessionId)!.add(id);

    return image;
  }

  async getImage(id: number): Promise<Image | undefined> {
    return this.images.get(id);
  }

  async getImagesBySession(sessionId: string): Promise<Image[]> {
    const sessionImageIds = this.sessionImages.get(sessionId);
    if (!sessionImageIds) return [];

    return Array.from(sessionImageIds)
      .map(id => this.images.get(id))
      .filter((image): image is Image => image !== undefined);
  }
}

export const storage = new MemStorage();