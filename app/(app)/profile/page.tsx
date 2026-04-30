"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthFormError from "@/components/auth/AuthFormError";
import PasswordStrengthHint from "@/components/auth/PasswordStrengthHint";
import ProfilePictureUploader from "@/components/auth/ProfilePictureUploader";
import { readCsrfCookie } from "@/lib/auth/csrf-client";
import { CSRF_HEADER_NAME } from "@/lib/auth/csrf-shared";

const inputClass =
  "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500";

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  profilePicture: string | null;
}

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Profile fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);

  // Password fields
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/profile");
      if (!res.ok) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      if (cancelled) return;
      const u = data.data.user as User;
      setUser(u);
      setFirstName(u.firstName);
      setLastName(u.lastName);
      setEmail(u.email);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileError(null);
    setProfileSaved(false);
    setProfileSaving(true);
    try {
      const csrf = readCsrfCookie() ?? "";
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          [CSRF_HEADER_NAME]: csrf,
        },
        body: JSON.stringify({ firstName, lastName, email }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setProfileError(data?.error?.message ?? "Save failed.");
        return;
      }
      setUser(data.data.user as User);
      setProfileSaved(true);
    } catch {
      setProfileError("Network error.");
    } finally {
      setProfileSaving(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSaved(false);
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords don't match.");
      return;
    }
    setPasswordSaving(true);
    try {
      const csrf = readCsrfCookie() ?? "";
      const res = await fetch("/api/profile/change-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [CSRF_HEADER_NAME]: csrf,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setPasswordError(data?.error?.message ?? "Change failed.");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSaved(true);
    } catch {
      setPasswordError("Network error.");
    } finally {
      setPasswordSaving(false);
    }
  }

  async function signOutEverywhere() {
    const csrf = readCsrfCookie() ?? "";
    await fetch("/api/auth/logout-all", {
      method: "POST",
      headers: { [CSRF_HEADER_NAME]: csrf },
    });
    router.push("/login");
    router.refresh();
  }

  async function signOut() {
    const csrf = readCsrfCookie() ?? "";
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { [CSRF_HEADER_NAME]: csrf },
    });
    router.push("/login");
    router.refresh();
  }

  if (loading || !user) {
    return <p className="text-sm text-gray-500">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Profile</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage your account, password, and profile picture.
        </p>
      </div>

      <section className="bg-white rounded-2xl shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Photo</h2>
        <ProfilePictureUploader
          firstName={user.firstName}
          lastName={user.lastName}
          currentUrl={user.profilePicture}
          onUploaded={(url) => setUser({ ...user, profilePicture: url })}
        />
      </section>

      <section className="bg-white rounded-2xl shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Account</h2>
        <form onSubmit={saveProfile} className="space-y-4" noValidate>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="profile-first" className="block text-sm font-medium text-gray-700 mb-1">
                First name
              </label>
              <input
                id="profile-first"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className={inputClass}
                disabled={profileSaving}
              />
            </div>
            <div>
              <label htmlFor="profile-last" className="block text-sm font-medium text-gray-700 mb-1">
                Last name
              </label>
              <input
                id="profile-last"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className={inputClass}
                disabled={profileSaving}
              />
            </div>
          </div>
          <div>
            <label htmlFor="profile-email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              id="profile-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              disabled={profileSaving}
            />
            <p className="text-xs text-gray-400 mt-1.5">
              Changing your email will sign you out of other devices.
            </p>
          </div>
          <AuthFormError message={profileError} />
          {profileSaved ? (
            <p className="text-xs text-emerald-600">Saved.</p>
          ) : null}
          <button
            type="submit"
            className="bg-blue-600 text-white rounded-lg py-2 px-4 text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-60"
            disabled={profileSaving}
          >
            {profileSaving ? "Saving…" : "Save changes"}
          </button>
        </form>
      </section>

      <section className="bg-white rounded-2xl shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Password</h2>
        <form onSubmit={changePassword} className="space-y-4" noValidate>
          <div>
            <label htmlFor="profile-current" className="block text-sm font-medium text-gray-700 mb-1">
              Current password
            </label>
            <input
              id="profile-current"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={inputClass}
              disabled={passwordSaving}
            />
          </div>
          <div>
            <label htmlFor="profile-new" className="block text-sm font-medium text-gray-700 mb-1">
              New password
            </label>
            <input
              id="profile-new"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputClass}
              disabled={passwordSaving}
            />
            <PasswordStrengthHint value={newPassword} />
          </div>
          <div>
            <label htmlFor="profile-confirm" className="block text-sm font-medium text-gray-700 mb-1">
              Confirm new password
            </label>
            <input
              id="profile-confirm"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputClass}
              disabled={passwordSaving}
            />
          </div>
          <AuthFormError message={passwordError} />
          {passwordSaved ? (
            <p className="text-xs text-emerald-600">
              Password updated. Other devices have been signed out.
            </p>
          ) : null}
          <button
            type="submit"
            className="bg-blue-600 text-white rounded-lg py-2 px-4 text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-60"
            disabled={passwordSaving}
          >
            {passwordSaving ? "Updating…" : "Update password"}
          </button>
        </form>
      </section>

      <section className="bg-white rounded-2xl shadow-sm p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Sessions</h2>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={signOut}
            className="border border-gray-200 text-gray-700 rounded-lg py-2 px-4 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Sign out
          </button>
          <button
            type="button"
            onClick={signOutEverywhere}
            className="border border-red-200 text-red-700 rounded-lg py-2 px-4 text-sm font-medium hover:bg-red-50 transition-colors"
          >
            Sign out everywhere
          </button>
        </div>
      </section>
    </div>
  );
}
