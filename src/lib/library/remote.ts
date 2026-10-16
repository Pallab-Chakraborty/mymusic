import type { LibraryState, Playlist, RecentTrack, Settings, Track } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";
import type { Op } from "./ops";
import { RemoteError, toRemoteError } from "./errors";

/** Everything the library needs from the cloud. A fake is used in tests. */
export interface LibraryRemote {
  /** Download the user's complete library. */
  fetchAll(): Promise<LibraryState>;
  /** Send one change. Must be safe to call twice with the same op. */
  apply(op: Op): Promise<void>;
  /** Permanently remove trashed playlists past the retention period. Returns how many. */
  purgeExpired(): Promise<number>;
}

/**
 * The small part of the Supabase client we use, described as an interface so
 * this file does not depend on Supabase's very large generated types.
 */
interface QueryResult<T> {
  data: T | null;
  error: unknown;
  status?: number;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQuery<T = any> = PromiseLike<QueryResult<T>> & Record<string, any>;
export interface SupabaseLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
  rpc(fn: string, args?: Record<string, unknown>): AnyQuery;
}

/** A request that never answers must not leave "Saving…" on screen forever. */
const REQUEST_TIMEOUT_MS = 20_000;
function withTimeout<T>(p: PromiseLike<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new RemoteError("The server took too long to answer.", "network", "timeout")),
      REQUEST_TIMEOUT_MS,
    );
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

const PAGE = 1000; // Supabase returns at most 1000 rows per request

interface PlaylistRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
interface TrackRow {
  playlist_id: string;
  video_id: string;
  title: string;
  channel_title: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  position: number;
}
interface RecentRow extends Omit<TrackRow, "playlist_id" | "position"> {
  played_at: string;
}
interface SettingsRow {
  trash_retention_days: number;
  shuffle: boolean;
  repeat_mode: Settings["repeatMode"];
}

const rowToTrack = (
  r: Pick<TrackRow, "video_id" | "title" | "channel_title" | "thumbnail_url" | "duration_seconds">,
): Track => ({
  videoId: r.video_id,
  title: r.title,
  channelTitle: r.channel_title,
  thumbnailUrl: r.thumbnail_url,
  durationSeconds: r.duration_seconds,
});

const trackArgs = (t: Track) => ({
  p_video_id: t.videoId,
  p_title: t.title,
  p_channel_title: t.channelTitle,
  p_thumbnail_url: t.thumbnailUrl,
  p_duration_seconds: t.durationSeconds,
});

export function createSupabaseRemote(supabase: SupabaseLike, userId: string): LibraryRemote {
  /** Fetch every page of a query. Without this, libraries over 1000 songs would silently look truncated. */
  async function fetchAllPages<T>(build: (from: number, to: number) => AnyQuery<T[]>): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error, status } = await withTimeout(build(from, from + PAGE - 1));
      if (error) throw toRemoteError(error, status);
      const page = data ?? [];
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  }

  async function check<T>(q: PromiseLike<QueryResult<T>>): Promise<T | null> {
    let res: QueryResult<T>;
    try {
      res = await withTimeout(q);
    } catch (e) {
      throw toRemoteError(e);
    }
    if (res.error) throw toRemoteError(res.error, res.status);
    return res.data;
  }

  /** Update rows and make sure something was actually changed. */
  async function updatePlaylist(id: string, patch: Record<string, unknown>) {
    const rows = await check<{ id: string }[]>(supabase.from("playlists").update(patch).eq("id", id).select("id"));
    if (!rows || rows.length === 0) {
      throw new RemoteError("That playlist no longer exists.", "permanent", "P0002");
    }
  }

  return {
    async fetchAll() {
      const [playlistRows, trackRows, recentRows, settingsRows] = await Promise.all([
        fetchAllPages<PlaylistRow>((from, to) =>
          supabase.from("playlists").select("*").order("created_at", { ascending: false }).order("id").range(from, to),
        ),
        fetchAllPages<TrackRow>((from, to) =>
          supabase
            .from("playlist_tracks")
            .select("playlist_id, video_id, title, channel_title, thumbnail_url, duration_seconds, position")
            .order("playlist_id")
            .order("position")
            .range(from, to),
        ),
        fetchAllPages<RecentRow>((from, to) =>
          supabase
            .from("recently_played")
            .select("video_id, title, channel_title, thumbnail_url, duration_seconds, played_at")
            .order("played_at", { ascending: false })
            .range(from, to),
        ),
        check<SettingsRow[]>(
          supabase
            .from("user_settings")
            .select("trash_retention_days, shuffle, repeat_mode")
            .eq("user_id", userId)
            .limit(1),
        ),
      ]);

      const tracksByPlaylist = new Map<string, Track[]>();
      for (const row of trackRows) {
        const list = tracksByPlaylist.get(row.playlist_id) ?? [];
        list.push(rowToTrack(row));
        tracksByPlaylist.set(row.playlist_id, list);
      }

      const playlists: Playlist[] = playlistRows.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        deletedAt: p.deleted_at,
        tracks: tracksByPlaylist.get(p.id) ?? [],
      }));

      const recent: RecentTrack[] = recentRows.map((r) => ({ ...rowToTrack(r), playedAt: r.played_at }));

      const s = settingsRows?.[0];
      const settings: Settings = s
        ? { trashRetentionDays: s.trash_retention_days, shuffle: s.shuffle, repeatMode: s.repeat_mode }
        : DEFAULT_SETTINGS;

      return { playlists, recent, settings };
    },

    async apply(op) {
      switch (op.type) {
        case "createPlaylist":
          await check(supabase.rpc("create_playlist", { p_id: op.id, p_name: op.name }));
          return;

        case "renamePlaylist":
          await updatePlaylist(op.id, { name: op.name.trim() });
          return;

        case "softDeletePlaylist":
          await updatePlaylist(op.id, { deleted_at: op.at });
          return;

        case "restorePlaylist":
          await updatePlaylist(op.id, { deleted_at: null });
          return;

        case "permanentDeletePlaylist": {
          const removed = await check<{ id: string }[]>(
            supabase.from("playlists").delete().eq("id", op.id).select("id"),
          );
          if (removed && removed.length > 0) return;
          // Nothing deleted: either it is already gone (fine) or it is not in the trash (refuse).
          const still = await check<{ id: string }[]>(supabase.from("playlists").select("id").eq("id", op.id).limit(1));
          if (still && still.length > 0) {
            throw new RemoteError(
              "Only playlists in the trash can be permanently deleted.",
              "permanent",
              "not_in_trash",
            );
          }
          return;
        }

        case "addTrack":
          await check(supabase.rpc("add_track_to_playlist", { p_playlist_id: op.playlistId, ...trackArgs(op.track) }));
          return;

        case "removeTrack":
          await check(
            supabase.rpc("remove_track_from_playlist", { p_playlist_id: op.playlistId, p_video_id: op.videoId }),
          );
          return;

        case "reorderTracks":
          await check(
            supabase.rpc("reorder_playlist_tracks", { p_playlist_id: op.playlistId, p_video_ids: op.videoIds }),
          );
          return;

        case "duplicatePlaylist":
          await check(
            supabase.rpc("duplicate_playlist", { p_source_id: op.sourceId, p_new_id: op.newId, p_new_name: op.name }),
          );
          return;

        case "recordPlay":
          await check(supabase.rpc("record_play", trackArgs(op.track)));
          return;

        case "updateSettings": {
          const patch: Record<string, unknown> = {};
          if (op.patch.trashRetentionDays !== undefined) patch.trash_retention_days = op.patch.trashRetentionDays;
          if (op.patch.shuffle !== undefined) patch.shuffle = op.patch.shuffle;
          if (op.patch.repeatMode !== undefined) patch.repeat_mode = op.patch.repeatMode;
          if (Object.keys(patch).length === 0) return;
          const rows = await check<{ user_id: string }[]>(
            supabase.from("user_settings").update(patch).eq("user_id", userId).select("user_id"),
          );
          if (!rows || rows.length === 0) {
            // Settings row missing (should not happen): create it.
            await check(supabase.from("user_settings").insert({ user_id: userId, ...patch }));
          }
          return;
        }
      }
    },

    async purgeExpired() {
      const n = await check<number>(supabase.rpc("purge_expired_playlists"));
      return typeof n === "number" ? n : 0;
    },
  };
}
