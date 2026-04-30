"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AuthCard from "@/components/auth/AuthCard";
import AuthFormError from "@/components/auth/AuthFormError";
import PasswordStrengthHint from "@/components/auth/PasswordStrengthHint";
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";
import { readCsrfCookie } from "@/lib/auth/csrf-client";
import { CSRF_HEADER_NAME } from "@/lib/auth/csrf-shared";

const inputClass =
  "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500";

interface FieldErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

export default function RegisterPage() {
  const router = useRouter();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTopError(null);
    setFieldErrors({});

    if (password !== confirmPassword) {
      setFieldErrors({ confirmPassword: "Passwords don't match." });
      return;
    }

    setSubmitting(true);
    try {
      const csrf = readCsrfCookie() ?? "";
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [CSRF_HEADER_NAME]: csrf,
        },
        body: JSON.stringify({ firstName, lastName, email, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const errs = data?.error?.fieldErrors as FieldErrors | undefined;
        if (errs) setFieldErrors(errs);
        else setTopError(data?.error?.message ?? "Registration failed.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setTopError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Join Saffron Wealth in under a minute."
      footer={
        <div>
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-blue-600 hover:text-blue-700 font-medium"
          >
            Sign in
          </Link>
        </div>
      }
    >
      <GoogleSignInButton label="Sign up with Google" />
      <div className="flex items-center gap-3 my-4">
        <div className="h-px flex-1 bg-gray-200" />
        <span className="text-xs text-gray-400 uppercase tracking-wide">or</span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="reg-first"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              First name
            </label>
            <input
              id="reg-first"
              type="text"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className={inputClass}
              required
              disabled={submitting}
            />
            <AuthFormError message={fieldErrors.firstName} />
          </div>
          <div>
            <label
              htmlFor="reg-last"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Last name
            </label>
            <input
              id="reg-last"
              type="text"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className={inputClass}
              required
              disabled={submitting}
            />
            <AuthFormError message={fieldErrors.lastName} />
          </div>
        </div>

        <div>
          <label
            htmlFor="reg-email"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Email
          </label>
          <input
            id="reg-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            required
            disabled={submitting}
          />
          <AuthFormError message={fieldErrors.email} />
        </div>

        <div>
          <label
            htmlFor="reg-password"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Password
          </label>
          <input
            id="reg-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            required
            disabled={submitting}
          />
          {fieldErrors.password ? (
            <AuthFormError message={fieldErrors.password} />
          ) : (
            <PasswordStrengthHint value={password} />
          )}
        </div>

        <div>
          <label
            htmlFor="reg-confirm"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Confirm password
          </label>
          <input
            id="reg-confirm"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={inputClass}
            required
            disabled={submitting}
          />
          <AuthFormError message={fieldErrors.confirmPassword} />
        </div>

        <AuthFormError message={topError} />

        <button
          type="submit"
          className="w-full bg-blue-600 text-white rounded-lg py-2 px-4 text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-60"
          disabled={submitting}
        >
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </form>
    </AuthCard>
  );
}
