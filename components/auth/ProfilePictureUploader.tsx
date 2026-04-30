"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import AvatarFallback from "./AvatarFallback";
import { readCsrfCookie } from "@/lib/auth/csrf-client";
import { CSRF_HEADER_NAME } from "@/lib/auth/csrf-shared";

interface Props {
  firstName: string;
  lastName: string;
  currentUrl: string | null;
  onUploaded: (url: string) => void;
}

export default function ProfilePictureUploader({
  firstName,
  lastName,
  currentUrl,
  onUploaded,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);

    if (file.size > 5 * 1024 * 1024) {
      setError("Maximum size is 5MB.");
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Use a PNG, JPEG, or WebP image.");
      return;
    }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const csrf = readCsrfCookie() ?? "";
      const res = await fetch("/api/profile/picture", {
        method: "POST",
        headers: { [CSRF_HEADER_NAME]: csrf },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data?.error?.message ?? "Upload failed.");
        return;
      }
      onUploaded(data.data.profilePicture as string);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-4">
      {currentUrl ? (
        <Image
          src={currentUrl}
          alt={`${firstName} ${lastName}`}
          width={80}
          height={80}
          className="rounded-full object-cover"
          unoptimized
        />
      ) : (
        <AvatarFallback firstName={firstName} lastName={lastName} size={80} />
      )}
      <div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="border border-gray-200 text-gray-700 rounded-lg py-1.5 px-3 text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-60"
        >
          {uploading ? "Uploading…" : "Change photo"}
        </button>
        <p className="text-xs text-gray-400 mt-1.5">
          PNG, JPEG, or WebP. Max 5MB.
        </p>
        {error ? (
          <p className="text-xs text-red-500 mt-1.5">{error}</p>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={onPick}
          className="hidden"
        />
      </div>
    </div>
  );
}
