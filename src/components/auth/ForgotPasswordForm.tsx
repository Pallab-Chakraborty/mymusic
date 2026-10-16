"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/authErrors";
import { Button, ErrorBox } from "@/components/ui/primitives";
import { AuthShell, Field } from "./AuthShell";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: err } = await createClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setBusy(false);
    // Only real problems (network, rate limit) are shown. Whether the address exists is never revealed.
    if (err && (err.status === 429 || /rate|fetch|network/i.test(err.message ?? ""))) {
      setError(friendlyAuthError(err));
      return;
    }
    setSent(true);
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle={sent ? undefined : "We'll email you a link to choose a new one."}
      footer={
        <Link href="/login" className="text-violet hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <p role="status" className="text-sm leading-relaxed">
          If an account exists for <strong>{email.trim()}</strong>, a reset link is on its way. It can take a few
          minutes. Check your spam folder too.
        </p>
      ) : (
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
          {error && <ErrorBox>{error}</ErrorBox>}
          <Button type="submit" variant="primary" className="w-full" disabled={busy || !email}>
            {busy ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
