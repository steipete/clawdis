import crypto from "node:crypto";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { normalizeBrowserScreenshot } from "./screenshot.js";

describe("browser screenshot normalization", () => {
  it("shrinks oversized images to <=2000x2000 and <=5MB", async () => {
    const width = 2300;
    const height = 2300;
    const raw = crypto.randomBytes(width * height * 3);
    const bigPng = await sharp(raw, { raw: { width, height, channels: 3 } })
      .png({ compressionLevel: 0 })
      .toBuffer();

    const normalized = await normalizeBrowserScreenshot(bigPng, {
      maxSide: 2000,
      maxBytes: 5 * 1024 * 1024,
    });

    expect(normalized.buffer.byteLength).toBeLessThanOrEqual(5 * 1024 * 1024);
    const meta = await sharp(normalized.buffer).metadata();
    expect(Number(meta.width)).toBeLessThanOrEqual(2000);
    expect(Number(meta.height)).toBeLessThanOrEqual(2000);
    expect(normalized.buffer[0]).toBe(0xff);
    expect(normalized.buffer[1]).toBe(0xd8);
  }, 30_000);

  it("keeps already-small screenshots unchanged", async () => {
    const jpeg = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .jpeg({ quality: 80 })
      .toBuffer();

    const normalized = await normalizeBrowserScreenshot(jpeg, {
      maxSide: 2000,
      maxBytes: 5 * 1024 * 1024,
    });

    expect(normalized.buffer.equals(jpeg)).toBe(true);
  });
});
