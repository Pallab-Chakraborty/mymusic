"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { friendlyAuthError, MIN_PASSWORD_LENGTH } from "@/lib/authErrors";
import { Button, ErrorBox } from "@/components/ui/primitives";
import { AuthShell, Field } from "./AuthShell";
import { GoogleButton } from "./GoogleButton";

export function RegisterForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    const { data, error: err } = await createClient().auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (err) {
      setError(friendlyAuthError(err));
      return;
    }
    if (data.session) {
      // Email confirmation is switched off in this Supabase project: already signed in.
      router.replace("/");
      router.refresh();
      return;
    }
    // Same message whether or not the address was already registered (prevents probing for accounts).
    setSentTo(email.trim());
  }

  if (sentTo) {
    return (
      <AuthShell
        title="Check your email"
        footer={
          <Link href="/login" className="text-violet hover:underline">
            Back to sign in
          </Link>
        }
      >
        <p className="text-sm leading-relaxed">
          If <strong>{sentTo}</strong> can be used for a new account, we&apos;ve sent a confirmation link to it. Open
          the link, then sign in. If nothing arrives in a few minutes, check your spam folder.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Your playlists are saved to it permanently."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="text-violet hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <div className="space-y-4">
        <GoogleButton onError={setError} />
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Field
            id="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Field
            id="confirm"
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {error && <ErrorBox>{error}</ErrorBox>}
          <Button type="submit" variant="primary" className="w-full" disabled={busy || !email || !password || !confirm}>
            {busy ? "Creating account…" : "Create account"}
          </Button>
        </form>
      </div>
    </AuthShell>
  );
}
