import type { Metadata } from "next";
import { PlaylistsView } from "@/components/pages/PlaylistsView";

export const metadata: Metadata = { title: "Playlists" };

export default function PlaylistsPage() {
  return <PlaylistsView />;
}
