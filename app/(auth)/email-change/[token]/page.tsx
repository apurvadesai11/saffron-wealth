"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AuthCard from "@/components/auth/AuthCard";
import AuthFormError from "@/components/auth/AuthFormError";
import { readCsrfCookie } from "@/lib/auth/csrf-client";
import { CSRF_HEADER_NAME } from "@/lib/auth/csrf-shared";

interface Props {
  params: Promise<{ token: string }>;
}

type State =
  | { kind: "confirming" }
  | { kind: "done"; email: string }
  | { kind: "failed"; message: string };

export default function EmailChangeConfirmPage({ params }: Props) {
  const { token } = use(params);
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "confirming" });

  // The token is single-use, so confirming twice turns a success into an
  // "invalid link" error. React 18+ mounts effects twice in dev StrictMode,
  // which would do exactly that.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      try {
        const csrf = readCsrfCookie() ?? "";
        const res = await fetch("/api/auth/email-change/confirm", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [CSRF_HEADER_NAME]: csrf,
          },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          setState({
            kind: "failed",
            message: data?.error?.message ?? "This link is invalid or has expired.",
          });
          return;
        }
        setState({ kind: "done", email: data.data.email });
        // Confirming revokes every session and issues a fresh one on this
        // device, so refresh to pick up the new identity.
        router.refresh();
      } catch {
        setState({
          kind: "failed",
          message: "Network error. Please try again.",
        });
      }
    })();
  }, [token, router]);

  if (state.kind === "confirming") {
    return (
      <AuthCard title="Confirming your email" subtitle="One moment.">
        <p className="text-sm text-gray-500">Applying the change…</p>
      </AuthCard>
    );
  }

  if (state.kind === "failed") {
    return (
      <AuthCard
        title="Couldn't confirm that address"
        subtitle="The link may have expired or already been used."
        footer={
          <Link href="/profile" className="text-blue-600 hover:text-blue-700">
            Back to your profile
          </Link>
        }
      >
        <AuthFormError message={state.message} />
        <p className="text-xs text-gray-500 mt-3">
          Email-change links are valid for 15 minutes and can be used once.
          Request the change again from your profile to get a new link.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Email address updated"
      subtitle="Use the new address to sign in from now on."
      footer={
        <Link href="/profile" className="text-blue-600 hover:text-blue-700">
          Go to your profile
        </Link>
      }
    >
      <p className="text-sm text-gray-700" data-confirmed-email={state.email}>
        Your account email is now{" "}
        <span className="font-medium">{state.email}</span>.
      </p>
      <p className="text-xs text-gray-500 mt-3">
        Every other signed-in device was signed out as a precaution.
      </p>
    </AuthCard>
  );
}
