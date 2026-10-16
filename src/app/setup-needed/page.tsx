import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";

export const metadata: Metadata = { title: "Setup needed" };

/** Shown instead of a crash when the Supabase settings haven't been entered yet. */
export default function SetupNeededPage() {
  return (
    <AuthShell title="One more setup step">
      <div className="space-y-3 text-sm leading-relaxed">
        <p>MyMusic isn&apos;t connected to its database yet. The app needs two settings:</p>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>
            <code className="rounded bg-ink px-1">NEXT_PUBLIC_SUPABASE_URL</code>
          </li>
          <li>
            <code className="rounded bg-ink px-1">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>
          </li>
        </ul>
        <p>
          Follow <strong>Step 3</strong> in the README to create them in a file called{" "}
          <code className="rounded bg-ink px-1">.env.local</code>, then restart the app. On Vercel, add them under{" "}
          <em>Settings → Environment Variables</em>.
        </p>
      </div>
    </AuthShell>
  );
}
