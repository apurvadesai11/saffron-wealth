import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  uploadAvatar,
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

    await prisma.user.update({
      where: { id: session.user.id },
      data: { profilePicture: publicUrl },
    });

    return NextResponse.json({
      ok: true,
      data: { profilePicture: publicUrl },
    });
  },
);
