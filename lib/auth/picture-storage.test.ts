import { describe, it, expect } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  validateImageBuffer,
  MAX_AVATAR_BYTES,
  deleteAvatar,
  isOwnedAvatarUrl,
} from "./picture-storage";

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

// ---------------------------------------------------------------------------
// deleteAvatar
// ---------------------------------------------------------------------------
//
// Every upload wrote a new blob under a fresh randomUUID() name and the route
// overwrote User.profilePicture, so the previous blob was never removed:
// unbounded storage growth, and every avatar a user had ever uploaded stayed
// readable at a permanent (if unguessable) URL. A user who replaces a photo
// reasonably expects the first one to be gone.
//
// The guard is the important half. OAuth users' profilePicture is Google's own
// lh3.googleusercontent.com URL (see app/api/auth/oauth/google/callback), which
// we do not own and must never try to delete.
describe("isOwnedAvatarUrl", () => {
  it("recognizes a local dev upload", () => {
    expect(isOwnedAvatarUrl("/uploads/avatars/abc-123.webp")).toBe(true);
  });

  it("recognizes a Vercel Blob upload we wrote", () => {
    expect(
      isOwnedAvatarUrl(
        "https://abc123.public.blob.vercel-storage.com/avatars/abc-123.webp",
      ),
    ).toBe(true);
  });

  it("does not claim a Google-hosted picture", () => {
    expect(
      isOwnedAvatarUrl("https://lh3.googleusercontent.com/a/ACg8ocK123=s96-c"),
    ).toBe(false);
  });

  it("does not claim an arbitrary external URL", () => {
    expect(isOwnedAvatarUrl("https://evil.test/avatars/x.webp")).toBe(false);
  });

  it("does not claim a blob URL outside our avatars prefix", () => {
    expect(
      isOwnedAvatarUrl(
        "https://abc123.public.blob.vercel-storage.com/invoices/secret.pdf",
      ),
    ).toBe(false);
  });

  // A stored value that walks out of the upload directory must not be treated
  // as ours, regardless of how it got into the column.
  it("does not claim a traversal path", () => {
    expect(isOwnedAvatarUrl("/uploads/avatars/../../../etc/passwd")).toBe(false);
    expect(isOwnedAvatarUrl("/uploads/avatars/..%2F..%2Fetc%2Fpasswd")).toBe(false);
  });

  it("does not claim empty or nullish values", () => {
    expect(isOwnedAvatarUrl("")).toBe(false);
    expect(isOwnedAvatarUrl(null)).toBe(false);
    expect(isOwnedAvatarUrl(undefined)).toBe(false);
  });

  // Not a subdomain-suffix match: an attacker-controlled host ending in the
  // blob domain must not pass.
  it("does not claim a lookalike blob host", () => {
    expect(
      isOwnedAvatarUrl("https://evil.test/x.public.blob.vercel-storage.com/avatars/a.webp"),
    ).toBe(false);
  });
});

describe("deleteAvatar", () => {
  it("unlinks a local upload", async () => {
    const dir = path.join(process.cwd(), "public", "uploads", "avatars");
    await mkdir(dir, { recursive: true });
    const name = `test-${randomUUID()}.webp`;
    const filepath = path.join(dir, name);
    await writeFile(filepath, Buffer.from("x"));
    expect(existsSync(filepath)).toBe(true);

    const deleted = await deleteAvatar(`/uploads/avatars/${name}`);

    expect(deleted).toBe(true);
    expect(existsSync(filepath)).toBe(false);
  });

  it("returns false for a Google URL and does not throw", async () => {
    await expect(
      deleteAvatar("https://lh3.googleusercontent.com/a/ACg8ocK123=s96-c"),
    ).resolves.toBe(false);
  });

  // An orphaned blob is a smaller problem than a failed request, so a delete
  // that cannot succeed reports false rather than throwing.
  it("returns false rather than throwing when the local file is already gone", async () => {
    await expect(
      deleteAvatar(`/uploads/avatars/definitely-missing-${randomUUID()}.webp`),
    ).resolves.toBe(false);
  });

  it("returns false for a traversal path without touching the filesystem", async () => {
    await expect(deleteAvatar("/uploads/avatars/../../../etc/passwd")).resolves.toBe(false);
  });
});
