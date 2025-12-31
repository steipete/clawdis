import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { sanitizeContentBlocksImages } from "./tool-images.js";

describe("tool image sanitizing", () => {
  it("shrinks oversized images to <=5MB", async () => {
    const width = 2800;
    const height = 2800;
    const raw = Buffer.alloc(width * height * 3, 0xff);
    const bigPng = await sharp(raw, {
      raw: { width, height, channels: 3 },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    expect(bigPng.byteLength).toBeGreaterThan(5 * 1024 * 1024);

    const blocks = [
      {
        type: "image" as const,
        data: bigPng.toString("base64"),
        mimeType: "image/png",
      },
    ];

    const out = await sanitizeContentBlocksImages(blocks, "test");
    const image = out.find((b) => b.type === "image");
    if (!image || image.type !== "image") {
      throw new Error("expected image block");
    }
    const size = Buffer.from(image.data, "base64").byteLength;
    expect(size).toBeLessThanOrEqual(5 * 1024 * 1024);
    expect(image.mimeType).toBe("image/jpeg");
  }, 20_000);
});
