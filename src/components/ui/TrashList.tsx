"use client";

import { useState } from "react";
import { useLibrary } from "@/components/providers/LibraryProvider";
import { timeAgo } from "@/lib/format";
import type { Playlist } from "@/lib/types";
import { Button, Modal } from "./primitives";

/** Deleted playlists: restore them, or erase one for good (after a clear warning). */
export function TrashList() {
  const library = useLibrary();
  const [target, setTarget] = useState<Playlist | null>(null);

  return (
    <>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
        {library.trash.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{p.name}</p>
              <p className="text-xs text-muted">
                {p.tracks.length} {p.tracks.length === 1 ? "song" : "songs"} · deleted {timeAgo(p.deletedAt)}
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => library.restorePlaylist(p.id)}>Restore</Button>
              <Button variant="danger" onClick={() => setTarget(p)}>
                Delete forever…
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <Modal open={target !== null} onClose={() => setTarget(null)} title="Delete forever?">
        {target && (
          <div className="space-y-4 text-sm">
            <p>
              <strong>{target.name}</strong> and its {target.tracks.length}{" "}
              {target.tracks.length === 1 ? "song" : "songs"} will be erased from your account.{" "}
              <strong>This cannot be undone.</strong>
            </p>
            <p className="text-muted">
              If you might want it later, keep it in the trash instead. It will be removed automatically after{" "}
              {library.library.settings.trashRetentionDays} days. Exporting a backup first (Settings) is also a good
              idea.
            </p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setTarget(null)}>Keep it</Button>
              <Button
                variant="danger"
                onClick={() => {
                  library.permanentlyDeletePlaylist(target.id);
                  setTarget(null);
                }}
              >
                Delete forever
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
