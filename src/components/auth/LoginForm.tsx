"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/authErrors";
import { safeNextPath } from "@/lib/safeNext";
import { Button, ErrorBox } from "@/components/ui/primitives";
import { AuthShell, Field } from "./AuthShell";
import { GoogleButton } from "./GoogleButton";

const CALLBACK_ERRORS: Record<string, string> = {
  callback: "Sign-in could not be completed. Please try again.",
  link: "That email link is invalid or has expired. Request a new one.",
};

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const initialError = CALLBACK_ERRORS[params.get("error") ?? ""] ?? null;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: err } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
    if (err) {
      setBusy(false);
      setError(friendlyAuthError(err));
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to open your library."
      footer={
        <>
          New here?{" "}
          <Link href="/register" className="text-violet hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <div className="space-y-4">
        <GoogleButton next={next} onError={setError} />
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
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <ErrorBox>{error}</ErrorBox>}
          <Button type="submit" variant="primary" className="w-full" disabled={busy || !email || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <p className="text-center text-sm">
          <Link href="/forgot-password" className="text-muted hover:text-fg hover:underline">
            Forgot your password?
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
