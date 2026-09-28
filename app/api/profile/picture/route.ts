import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  uploadAvatar,
  deleteAvatar,
  validateImageBuffer,
  processAvatarImage,
  MAX_AVATAR_BYTES,
} from "@/lib/auth/picture-storage";
import { withApiHandler } from "@/lib/api/handler";
import { err } from "@/lib/api/errors";

export const runtime = "nodejs";

// Rate-limited because each request is a sharp decode, resize and WebP
// re-encode — real CPU per call.
export const POST = withApiHandler(
  { logLabel: "api/profile/picture", csrf: true, rateLimit: "picture" },
  async ({ req, session }) => {
    // Hard-stop oversized requests before reading the full body.
    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (contentLength > MAX_AVATAR_BYTES + 8 * 1024) {
      return err("FILE_TOO_LARGE", "Maximum upload size is 5MB.", 413);
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return err("BAD_REQUEST", "Expected multipart/form-data with a 'file' field.", 400);
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return err("BAD_REQUEST", "Missing 'file' field.", 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const validation = await validateImageBuffer(buffer);
    if (!validation.ok) {
      return err("INVALID_IMAGE", validation.reason ?? "Image rejected.", 400);
    }

    let processed: Buffer;
    try {
      processed = await processAvatarImage(buffer);
    } catch {
      return err("PROCESSING_FAILED", "Could not process the image.", 500);
    }

    let publicUrl: string;
    try {
      publicUrl = await uploadAvatar(processed);
    } catch (uploadErr) {
      console.error("[profile/picture] upload failed", uploadErr);
      return err("UPLOAD_FAILED", "Could not save the image. Try again.", 500);
    }

    // Read before the update: the old pointer is the only handle on the old
    // blob, and the update overwrites it.
    const previous = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { profilePicture: true },
    });

    await prisma.user.update({
      where: { id: session.user.id },
      data: { profilePicture: publicUrl },
    });

    // Strictly after the pointer has moved. Deleting first would leave a
    // broken image if the update then failed. deleteAvatar ignores anything we
    // did not write — notably OAuth users' lh3.googleusercontent.com URLs —
    // and never throws on a storage failure, but the await is guarded anyway
    // so a future change there cannot turn an orphaned blob into a failed
    // upload. An orphan is the cheaper outcome.
    if (previous?.profilePicture) {
      try {
        await deleteAvatar(previous.profilePicture);
      } catch (deleteErr) {
        console.error("[profile/picture] deleting previous avatar failed", deleteErr);
      }
    }

    return NextResponse.json({
      ok: true,
      data: { profilePicture: publicUrl },
    });
  },
);
