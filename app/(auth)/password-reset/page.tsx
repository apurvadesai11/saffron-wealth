"use client";

import { useState } from "react";
import Link from "next/link";
import AuthCard from "@/components/auth/AuthCard";
import AuthFormError from "@/components/auth/AuthFormError";
import { readCsrfCookie } from "@/lib/auth/csrf-client";
import { CSRF_HEADER_NAME } from "@/lib/auth/csrf-shared";

const inputClass =
  "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500";

export default function PasswordResetRequestPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTopError(null);
    setSubmitting(true);
    try {
      const csrf = readCsrfCookie() ?? "";
      const res = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [CSRF_HEADER_NAME]: csrf,
        },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setTopError(data?.error?.message ?? "Something went wrong.");
        return;
      }
      setSubmitted(true);
    } catch {
      setTopError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <AuthCard
        title="Check your email"
        subtitle="If an account exists for that email, we've sent a password reset link. The link expires in 15 minutes."
        footer={
          <Link
            href="/login"
            className="text-blue-600 hover:text-blue-700 font-medium"
          >
            Back to sign in
          </Link>
        }
      >
        <p className="text-sm text-gray-600">
          Didn&apos;t get an email? Check your spam folder, or{" "}
          <button
            type="button"
            onClick={() => setSubmitted(false)}
            className="text-blue-600 hover:text-blue-700"
          >
            try again
          </button>
          .
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      subtitle="Enter your email and we'll send you a reset link."
      footer={
        <div>
          Remembered it?{" "}
          <Link
            href="/login"
            className="text-blue-600 hover:text-blue-700 font-medium"
          >
            Back to sign in
          </Link>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label
            htmlFor="reset-email"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Email
          </label>
          <input
            id="reset-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            required
            disabled={submitting}
          />
        </div>
        <AuthFormError message={topError} />
        <button
          type="submit"
          className="w-full bg-blue-600 text-white rounded-lg py-2 px-4 text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-60"
          disabled={submitting}
        >
          {submitting ? "Sending…" : "Send reset link"}
        </button>
      </form>
    </AuthCard>
  );
}
