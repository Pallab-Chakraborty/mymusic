/** A song as we store it (copied from YouTube search results). */
export interface Track {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
}

export interface RecentTrack extends Track {
  playedAt: string;
}

export interface Playlist {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  /** null = active. A date = in the trash (recoverable). */
  deletedAt: string | null;
  /** In play order. */
  tracks: Track[];
}

export type RepeatMode = "off" | "all" | "one";

export interface Settings {
  trashRetentionDays: number;
  shuffle: boolean;
  repeatMode: RepeatMode;
}

export interface LibraryState {
  playlists: Playlist[];
  recent: RecentTrack[];
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  trashRetentionDays: 30,
  shuffle: false,
  repeatMode: "off",
};

export const EMPTY_LIBRARY: LibraryState = {
  playlists: [],
  recent: [],
  settings: DEFAULT_SETTINGS,
};

export const MAX_RECENT = 100;
export const MAX_PLAYLIST_NAME = 100;
