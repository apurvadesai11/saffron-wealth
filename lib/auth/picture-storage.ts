import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const LOCAL_UPLOAD_DIR = path.join(
  process.cwd(),
  "public",
  "uploads",
  "avatars",
);

// Uploads a processed avatar buffer (already re-encoded to WebP, EXIF stripped,
// resized) and returns a public URL. Uses Vercel Blob in production when
// BLOB_READ_WRITE_TOKEN is configured; falls back to public/uploads/avatars
// for local dev so uploads work without external services.
export async function uploadAvatar(buffer: Buffer): Promise<string> {
  const filename = `${randomUUID()}.webp`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    const result = await put(`avatars/${filename}`, buffer, {
      access: "public",
      contentType: "image/webp",
      addRandomSuffix: false,
    });
    return result.url;
  }

  if (!existsSync(LOCAL_UPLOAD_DIR)) {
    await mkdir(LOCAL_UPLOAD_DIR, { recursive: true });
  }
  const filepath = path.join(LOCAL_UPLOAD_DIR, filename);
  await writeFile(filepath, buffer);
  return `/uploads/avatars/${filename}`;
}

export interface ImageValidationResult {
  ok: boolean;
  reason?: string;
  detectedMime?: string;
}

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5MB

// MIME-sniff via magic bytes (file-type), NOT trusting client Content-Type.
// Returns ok:false when the bytes don't match an allowed image type, or when
// the file is too large.
export async function validateImageBuffer(
  buffer: Buffer,
): Promise<ImageValidationResult> {
  if (buffer.length === 0) {
    return { ok: false, reason: "empty file" };
  }
  if (buffer.length > MAX_AVATAR_BYTES) {
    return { ok: false, reason: "file too large (max 5MB)" };
  }
  const { fileTypeFromBuffer } = await import("file-type");
  const ft = await fileTypeFromBuffer(buffer);
  if (!ft) {
    return { ok: false, reason: "could not detect file type" };
  }
  if (!ALLOWED_MIME.has(ft.mime)) {
    return {
      ok: false,
      reason: `unsupported file type: ${ft.mime}`,
      detectedMime: ft.mime,
    };
  }
  return { ok: true, detectedMime: ft.mime };
}

// Re-encode through sharp: drops EXIF (including GPS), normalizes orientation
// per EXIF rotate, resizes to fit a 512x512 square, converts everything to
// WebP. Output buffer is safe to upload.
export async function processAvatarImage(buffer: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp(buffer)
    .rotate() // honor EXIF orientation, then drop the metadata
    .resize(512, 512, { fit: "cover", position: "center" })
    .webp({ quality: 85 })
    .toBuffer();
}
