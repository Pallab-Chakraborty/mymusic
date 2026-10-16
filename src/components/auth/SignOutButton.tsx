"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IndexedDbStorage } from "@/lib/library/storage";
import { Button } from "@/components/ui/primitives";

/**
 * Signs out and removes the copy of the library kept on this device, so the
 * next person using a shared computer cannot see it. The cloud copy is untouched.
 * If changes are still waiting to be sent, the user is warned first.
 */
export function SignOutButton({ pendingCount = 0 }: { pendingCount?: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    if (
      pendingCount > 0 &&
      !window.confirm(
        `${pendingCount} change${pendingCount === 1 ? " has" : "s have"} not been saved to the cloud yet. Signing out now will discard ${pendingCount === 1 ? "it" : "them"}. Sign out anyway?`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().auth.signOut();
    if (err) {
      setBusy(false);
      setError("Couldn't sign out. Check your connection and try again.");
      return;
    }
    try {
      const storage = new IndexedDbStorage();
      for (const key of await storage.keys("mymusic:")) await storage.del(key);
    } catch {
      // Clearing the local copy is best effort.
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <div>
      <Button onClick={signOut} disabled={busy}>
        {busy ? "Signing out…" : "Sign out"}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
