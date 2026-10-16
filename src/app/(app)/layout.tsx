import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ToastProvider } from "@/components/providers/ToastProvider";
import { LibraryProvider } from "@/components/providers/LibraryProvider";
import { PlayerProvider } from "@/components/providers/PlayerProvider";
import { AddToPlaylistProvider } from "@/components/ui/AddToPlaylist";
import { AppShell } from "@/components/shell/AppShell";

// Everything here depends on who is signed in.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const supabase = await createClient();
  // getClaims() checks the sign-in token's signature, so it can be trusted here.
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/login");
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;

  return (
    <ToastProvider>
      {/* key: a different user always gets a fresh library and a fresh player. */}
      <LibraryProvider key={userId} userId={userId}>
        <PlayerProvider>
          <AddToPlaylistProvider>
            <AppShell email={email}>{children}</AppShell>
          </AddToPlaylistProvider>
        </PlayerProvider>
      </LibraryProvider>
    </ToastProvider>
  );
}
