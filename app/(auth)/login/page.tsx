"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import AuthCard from "@/components/auth/AuthCard";
import AuthFormError from "@/components/auth/AuthFormError";
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";
import { readCsrfCookie } from "@/lib/auth/csrf-client";
import { CSRF_HEADER_NAME } from "@/lib/auth/csrf-shared";

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  denied: "Sign-in with Google was cancelled.",
  invalid_state: "Sign-in with Google could not be verified. Please try again.",
  missing_code: "Sign-in with Google was incomplete. Please try again.",
  token_exchange_failed: "Couldn't complete Google sign-in. Please try again.",
  no_access_token: "Google didn't return an access token. Please try again.",
  userinfo_failed: "Couldn't read your Google profile. Please try again.",
  email_unverified: "Your Google email isn't verified. Verify it with Google and retry.",
  unconfigured: "Google sign-in isn't configured for this environment.",
};

const inputClass =
  "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";
  const oauthError = searchParams.get("oauth");
  const justReset = searchParams.get("reset") === "ok";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [topError, setTopError] = useState<string | null>(
    oauthError ? OAUTH_ERROR_MESSAGES[oauthError] ?? "Sign-in failed." : null,
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTopError(null);
    setSubmitting(true);
    try {
      const csrf = readCsrfCookie() ?? "";
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [CSRF_HEADER_NAME]: csrf,
        },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setTopError(data?.error?.message ?? "Sign-in failed.");
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      setTopError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Sign in"
      subtitle="Welcome back to Saffron Wealth."
      footer={
        <div className="space-y-1">
          <div>
            <Link
              href="/password-reset"
              className="text-blue-600 hover:text-blue-700"
            >
              Forgot your password?
            </Link>
          </div>
          <div>
            New here?{" "}
            <Link
              href="/register"
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              Create an account
            </Link>
          </div>
        </div>
      }
    >
      {justReset ? (
        <p className="text-xs text-emerald-600 mb-4">
          Password updated. Sign in with your new password.
        </p>
      ) : null}
      <GoogleSignInButton label="Sign in with Google" />
      <div className="flex items-center gap-3 my-4">
        <div className="h-px flex-1 bg-gray-200" />
        <span className="text-xs text-gray-400 uppercase tracking-wide">or</span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label
            htmlFor="login-email"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Email
          </label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            required
            disabled={submitting}
          />
        </div>
        <div>
          <label
            htmlFor="login-password"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Password
          </label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-400">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
