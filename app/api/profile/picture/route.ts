import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth/server";
import { validateCsrfFromRequest } from "@/lib/auth/csrf";
import {
  uploadAvatar,
  validateImageBuffer,
  processAvatarImage,
  MAX_AVATAR_BYTES,
} from "@/lib/auth/picture-storage";

function err(code: string, message: string, status: number) {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status },
  );
}

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return err("UNAUTHENTICATED", "Not signed in.", 401);
  if (!validateCsrfFromRequest(req)) return err("CSRF_FAILED", "Invalid request.", 403);

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
    return err(
      "INVALID_IMAGE",
      validation.reason ?? "Image rejected.",
      400,
    );
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
}
