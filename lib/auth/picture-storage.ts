import { mkdir, writeFile, unlink } from "node:fs/promises";
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

const LOCAL_URL_PREFIX = "/uploads/avatars/";
// The host Vercel Blob serves from, and the prefix uploadAvatar writes under.
const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";
const BLOB_PATH_PREFIX = "/avatars/";

/**
 * Whether `url` is an avatar this app wrote, and may therefore delete.
 *
 * The case this exists for: OAuth users' User.profilePicture is Google's own
 * lh3.googleusercontent.com URL, copied straight from the ID token profile
 * (app/api/auth/oauth/google/callback/route.ts). We do not own it, and a
 * delete must never be attempted against it. Anything not recognizably ours
 * is left alone — the default is "not mine".
 */
export function isOwnedAvatarUrl(url: string | null | undefined): boolean {
  if (!url) return false;

  if (url.startsWith(LOCAL_URL_PREFIX)) {
    // A stored value that walks out of the upload directory is not ours,
    // however it got into the column. Checked on the decoded form too, so an
    // encoded traversal can't slip through before path.resolve sees it.
    const name = url.slice(LOCAL_URL_PREFIX.length);
    let decoded = name;
    try {
      decoded = decodeURIComponent(name);
    } catch {
      return false;
    }
    if (!name || name !== decoded || decoded.includes("/") || decoded.includes("\\")) {
      return false;
    }
    const resolved = path.resolve(LOCAL_UPLOAD_DIR, decoded);
    return path.dirname(resolved) === path.resolve(LOCAL_UPLOAD_DIR);
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  // Host comparison, not a substring match on the whole URL: a path segment
  // that merely spells the blob domain must not qualify.
  return (
    parsed.protocol === "https:" &&
    parsed.hostname.endsWith(BLOB_HOST_SUFFIX) &&
    parsed.pathname.startsWith(BLOB_PATH_PREFIX)
  );
}

/**
 * Best-effort removal of a previously uploaded avatar. Returns whether the
 * blob is gone.
 *
 * Never throws. An orphaned blob is a smaller problem than a failed avatar
 * update, so callers treat a false return as nothing more than a log line —
 * the same posture recordAuthEvent takes toward audit-write failures.
 */
export async function deleteAvatar(url: string | null | undefined): Promise<boolean> {
  if (!isOwnedAvatarUrl(url)) return false;
  const owned = url as string;

  try {
    if (owned.startsWith(LOCAL_URL_PREFIX)) {
      const name = decodeURIComponent(owned.slice(LOCAL_URL_PREFIX.length));
      await unlink(path.join(LOCAL_UPLOAD_DIR, name));
      return true;
    }

    const { del } = await import("@vercel/blob");
    await del(owned);
    return true;
  } catch {
    // Already gone, permissions, network — all non-fatal by design.
    return false;
  }
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
