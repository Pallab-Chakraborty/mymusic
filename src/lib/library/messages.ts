import type { Op } from "./ops";

/**
 * Words shown AFTER the cloud confirmed a change. Returns null for changes
 * that need no announcement (the Saved indicator already covers them).
 */
export function savedMessage(op: Op, playlistName?: string): string | null {
  switch (op.type) {
    case "createPlaylist":
      return "Playlist created";
    case "renamePlaylist":
      return "Playlist renamed";
    case "softDeletePlaylist":
      return "Playlist moved to trash";
    case "restorePlaylist":
      return "Playlist restored";
    case "permanentDeletePlaylist":
      return "Playlist deleted permanently";
    case "addTrack":
      return playlistName ? `Added to ${playlistName}` : "Song added";
    case "removeTrack":
      return "Song removed";
    case "duplicatePlaylist":
      return "Playlist duplicated";
    case "updateSettings":
      return "Settings saved";
    case "reorderTracks":
    case "recordPlay":
      return null;
  }
}

/** What went wrong, in the user's words, when a change was refused. */
export function failedMessage(op: Op, reason: string): string {
  const what: Record<Op["type"], string> = {
    createPlaylist: "create the playlist",
    renamePlaylist: "rename the playlist",
    softDeletePlaylist: "move the playlist to the trash",
    restorePlaylist: "restore the playlist",
    permanentDeletePlaylist: "delete the playlist",
    addTrack: "add the song",
    removeTrack: "remove the song",
    reorderTracks: "save the new order",
    duplicatePlaylist: "duplicate the playlist",
    recordPlay: "record the play",
    updateSettings: "save the settings",
  };
  return `Couldn't ${what[op.type]}. ${reason}`;
}
