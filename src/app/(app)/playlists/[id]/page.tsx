import { PlaylistDetail } from "@/components/pages/PlaylistDetail";

export default async function PlaylistPage({ params }: PageProps<"/playlists/[id]">) {
  const { id } = await params;
  return <PlaylistDetail id={id} />;
}
