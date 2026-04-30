import { describe, it, expect } from "vitest";
import { validateImageBuffer, MAX_AVATAR_BYTES } from "./picture-storage";

// 8-byte PNG signature followed by an empty IHDR chunk.
const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01,
  0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00,
  0x1f, 0x15, 0xc4, 0x89,
]);

const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const WEBP_HEADER = Buffer.from([
  0x52, 0x49, 0x46, 0x46,
  0x00, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x20,
]);

describe("validateImageBuffer", () => {
  it("rejects an empty buffer", async () => {
    const result = await validateImageBuffer(Buffer.alloc(0));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/empty/i);
  });

  it("rejects a buffer larger than the size cap", async () => {
    const result = await validateImageBuffer(Buffer.alloc(MAX_AVATAR_BYTES + 1, 0));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/too large/i);
  });

  it("rejects PHP code disguised with a .png Content-Type (magic bytes mismatch)", async () => {
    const malicious = Buffer.from("<?php system($_GET['c']); ?>");
    const result = await validateImageBuffer(malicious);
    expect(result.ok).toBe(false);
  });

  it("rejects an SVG (which can carry script payloads)", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const result = await validateImageBuffer(svg);
    expect(result.ok).toBe(false);
  });

  it("accepts a PNG by magic bytes", async () => {
    const result = await validateImageBuffer(PNG_HEADER);
    expect(result.ok).toBe(true);
    expect(result.detectedMime).toBe("image/png");
  });

  it("accepts a JPEG by magic bytes", async () => {
    const result = await validateImageBuffer(JPEG_HEADER);
    expect(result.ok).toBe(true);
    expect(result.detectedMime).toBe("image/jpeg");
  });

  it("accepts a WebP by magic bytes", async () => {
    const result = await validateImageBuffer(WEBP_HEADER);
    expect(result.ok).toBe(true);
    expect(result.detectedMime).toBe("image/webp");
  });
});
