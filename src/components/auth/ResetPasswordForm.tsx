"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { friendlyAuthError, MIN_PASSWORD_LENGTH } from "@/lib/authErrors";
import { Button, ErrorBox } from "@/components/ui/primitives";
import { AuthShell, Field } from "./AuthShell";

/** Shown after the person opens the reset link in their email (which signs them in briefly). */
export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    const { error: err } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (err) {
      setError(friendlyAuthError(err));
      return;
    }
    setDone(true);
    setTimeout(() => {
      router.replace("/");
      router.refresh();
    }, 1500);
  }

  return (
    <AuthShell
      title="Choose a new password"
      footer={
        <Link href="/login" className="text-violet hover:underline">
          Back to sign in
        </Link>
      }
    >
      {done ? (
        <p role="status" className="text-sm">
          Password updated. Taking you to your library…
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field
            id="password"
            label="New password"
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
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {error && <ErrorBox>{error}</ErrorBox>}
          <Button type="submit" variant="primary" className="w-full" disabled={busy || !password || !confirm}>
            {busy ? "Saving…" : "Save new password"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
