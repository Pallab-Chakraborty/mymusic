"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useLibrary } from "@/components/providers/LibraryProvider";
import { usePlayer } from "@/components/providers/PlayerProvider";
import { thumbnailFor } from "@/lib/thumbnail";
import { PlaylistCover } from "@/components/ui/Thumb";
import { TrackRow } from "@/components/ui/TrackRow";
import { Button, EmptyState, IconButton, Modal, SkeletonRows, inputClass } from "@/components/ui/primitives";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  DownloadIcon,
  EditIcon,
  CloseIcon,
  GripIcon,
  PlayIcon,
  SearchIcon,
  ShuffleIcon,
  TrashIcon,
} from "@/components/ui/icons";
import { buildExport, buildM3u, safeFileName } from "@/lib/exportImport";
import { downloadText } from "@/lib/download";
import { formatTotalDuration } from "@/lib/format";
import { MAX_PLAYLIST_NAME, type Track } from "@/lib/types";
import { SORT_OPTIONS, filterTracks, sortTracks, type SortKey } from "@/lib/sortTracks";

const NO_TRACKS: Track[] = [];

export function PlaylistDetail({ id }: { id: string }) {
  const router = useRouter();
  const library = useLibrary();
  const player = usePlayer();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("manual");

  const playlist = library.library.playlists.find((p) => p.id === id);
  const allTracks = playlist?.tracks ?? NO_TRACKS;
  // What is on screen: the playlist's own order, narrowed by the search box and re-ordered by the sort choice.
  const shown = sortTracks(filterTracks(allTracks, query), sortKey);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (!library.loaded) return <SkeletonRows count={6} />;

  if (!playlist) {
    return (
      <EmptyState
        title="Playlist not found"
        action={
          <Link
            href="/playlists"
            className="inline-flex min-h-10 items-center rounded-lg bg-violet px-4 text-sm font-semibold text-ink"
          >
            Back to playlists
          </Link>
        }
      >
        It may have been deleted on another device.
      </EmptyState>
    );
  }

  const trashed = Boolean(playlist.deletedAt);
  const tracks = playlist.tracks;
  const searching = query.trim() !== "";
  // Dragging and the arrow buttons change the playlist itself, so they only make sense in your own order, unfiltered.
  const reorderable = !trashed && sortKey === "manual" && !searching;
  const canSaveOrder = !trashed && sortKey !== "manual" && !searching && tracks.length > 1;
  const total = tracks.reduce((s, t) => s + (t.durationSeconds ?? 0), 0);

  function move(videoId: string, to: number) {
    const ids = tracks.map((t) => t.videoId);
    const from = ids.indexOf(videoId);
    if (from < 0 || to < 0 || to >= ids.length) return;
    library.reorderTracks(id, arrayMove(ids, from, to));
  }

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const ids = tracks.map((t) => t.videoId);
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(e.over.id));
    if (from >= 0 && to >= 0) library.reorderTracks(id, arrayMove(ids, from, to));
  }

  function submitRename(e: FormEvent) {
    e.preventDefault();
    library.renamePlaylist(id, draft);
    setRenaming(false);
  }

  function shufflePlay(list: Track[]) {
    if (!library.library.settings.shuffle) player.setShuffle(true);
    player.playQueue(list, Math.floor(Math.random() * list.length));
  }

  return (
    <>
      {trashed && (
        <div
          role="status"
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm"
        >
          <span>This playlist is in the trash. It can&apos;t be edited until you restore it.</span>
          <Button onClick={() => library.restorePlaylist(id)}>Restore</Button>
        </div>
      )}

      <header className="relative mb-6 flex flex-col gap-5 overflow-hidden rounded-3xl border border-line bg-surface p-5 sm:flex-row sm:items-end md:p-6">
        {tracks[0] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailFor(tracks[0])}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-30 blur-3xl saturate-150"
          />
        )}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/60 to-transparent" />
        <PlaylistCover tracks={tracks} className="relative w-40 shrink-0 shadow-2xl shadow-black/60 sm:w-48" />
        <div className="relative min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-widest text-muted">Playlist</p>
          {renaming ? (
            <form onSubmit={submitRename} className="mt-1 flex gap-2">
              <label htmlFor="rename-playlist" className="sr-only">
                Playlist name
              </label>
              <input
                id="rename-playlist"
                autoFocus
                value={draft}
                maxLength={MAX_PLAYLIST_NAME}
                onChange={(e) => setDraft(e.target.value)}
                className={inputClass}
              />
              <Button type="submit" variant="primary" disabled={!draft.trim()}>
                Save
              </Button>
              <Button onClick={() => setRenaming(false)}>Cancel</Button>
            </form>
          ) : (
            <h1 className="mt-1 break-words text-3xl font-semibold tracking-tight md:text-4xl">{playlist.name}</h1>
          )}
          <p className="mt-2 text-sm text-muted">
            {tracks.length} {tracks.length === 1 ? "song" : "songs"}
            {total > 0 ? ` · ${formatTotalDuration(total)}` : ""}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {tracks.length > 0 && (
              <>
                <Button variant="primary" disabled={shown.length === 0} onClick={() => player.playQueue(shown, 0)}>
                  <PlayIcon size={16} /> {sortKey !== "manual" || searching ? "Play shown" : "Play"}
                </Button>
                <Button disabled={shown.length === 0} onClick={() => shufflePlay(shown)}>
                  <ShuffleIcon size={16} /> Shuffle
                </Button>
              </>
            )}
            {!trashed && (
              <>
                <Button
                  onClick={() => {
                    setDraft(playlist.name);
                    setRenaming(true);
                  }}
                >
                  <EditIcon size={16} /> Rename
                </Button>
                <Button
                  onClick={() => {
                    const newId = library.duplicatePlaylist(id);
                    if (newId) router.push(`/playlists/${newId}`);
                  }}
                >
                  <CopyIcon size={16} /> Duplicate
                </Button>
              </>
            )}
            <Button
              onClick={() =>
                downloadText(safeFileName(playlist.name, "json"), buildExport([playlist]), "application/json")
              }
            >
              <DownloadIcon size={16} /> Export JSON
            </Button>
            <Button
              onClick={() => downloadText(safeFileName(playlist.name, "m3u8"), buildM3u(playlist), "audio/x-mpegurl")}
            >
              <DownloadIcon size={16} /> Export M3U
            </Button>
            {!trashed && (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                <TrashIcon size={16} /> Delete
              </Button>
            )}
          </div>
        </div>
      </header>

      {tracks.length === 0 ? (
        <EmptyState
          title="This playlist is empty"
          action={
            <Link
              href="/search"
              className="inline-flex min-h-10 items-center rounded-lg bg-violet px-4 text-sm font-semibold text-ink hover:bg-[#a193ff]"
            >
              Search for songs
            </Link>
          }
        >
          Find a song, press the + button, and choose this playlist.
        </EmptyState>
      ) : (
        <>
          {!trashed && tracks.length > 1 && (
            <div className="mb-4 space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <SearchIcon
                    className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-muted"
                    size={18}
                  />
                  <label htmlFor="playlist-find" className="sr-only">
                    Find a song in this playlist
                  </label>
                  <input
                    id="playlist-find"
                    type="search"
                    value={query}
                    maxLength={100}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Find a song or artist in this playlist"
                    className={`${inputClass} pl-10`}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="playlist-sort" className="shrink-0 text-sm text-muted">
                    Sort by
                  </label>
                  <select
                    id="playlist-sort"
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as SortKey)}
                    className={`${inputClass} w-auto min-w-40 cursor-pointer`}
                  >
                    {SORT_OPTIONS.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {(searching || sortKey !== "manual") && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface/70 px-3 py-2 text-sm">
                  <p role="status" className="text-muted">
                    {searching
                      ? `${shown.length} of ${tracks.length} songs match.`
                      : `Showing ${SORT_OPTIONS.find((o) => o.key === sortKey)?.label.toLowerCase()}. Your own order is not changed.`}{" "}
                    {!reorderable && "Switch back to My order to drag songs around."}
                  </p>
                  <div className="flex gap-2">
                    {canSaveOrder && (
                      <Button
                        className="min-h-8 px-3 py-1 text-xs"
                        onClick={() => {
                          library.reorderTracks(
                            id,
                            shown.map((t) => t.videoId),
                          );
                          setSortKey("manual");
                        }}
                      >
                        Keep this order
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      className="min-h-8 px-3 py-1 text-xs"
                      onClick={() => {
                        setQuery("");
                        setSortKey("manual");
                      }}
                    >
                      <CloseIcon size={14} /> Reset
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {shown.length === 0 ? (
            <EmptyState title={`Nothing in this playlist matches “${query.trim()}”`}>
              Try fewer words, or search by the artist&apos;s name.
            </EmptyState>
          ) : !reorderable ? (
            <ul className="space-y-1" aria-label={`Songs in ${playlist.name}`}>
              {shown.map((t) => (
                <li key={t.videoId}>
                  <TrackRow
                    track={t}
                    context={shown}
                    showAdd={!trashed}
                    trailing={
                      trashed ? undefined : (
                        <IconButton
                          label={`Remove ${t.title} from this playlist`}
                          onClick={() => library.removeTrack(id, t.videoId)}
                        >
                          <TrashIcon size={18} />
                        </IconButton>
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={tracks.map((t) => t.videoId)} strategy={verticalListSortingStrategy}>
                <ul className="space-y-1" aria-label={`Songs in ${playlist.name}`}>
                  {tracks.map((t, i) => (
                    <SortableItem key={t.videoId} id={t.videoId}>
                      {(handle) => (
                        <TrackRow
                          track={t}
                          context={tracks}
                          leading={handle}
                          trailing={
                            <>
                              <IconButton
                                label={`Move ${t.title} up`}
                                className="hidden h-8 w-8 sm:inline-flex"
                                disabled={i === 0}
                                onClick={() => move(t.videoId, i - 1)}
                              >
                                <ChevronUpIcon size={16} />
                              </IconButton>
                              <IconButton
                                label={`Move ${t.title} down`}
                                className="hidden h-8 w-8 sm:inline-flex"
                                disabled={i === tracks.length - 1}
                                onClick={() => move(t.videoId, i + 1)}
                              >
                                <ChevronDownIcon size={16} />
                              </IconButton>
                              <IconButton
                                label={`Remove ${t.title} from this playlist`}
                                onClick={() => library.removeTrack(id, t.videoId)}
                              >
                                <TrashIcon size={18} />
                              </IconButton>
                            </>
                          }
                        />
                      )}
                    </SortableItem>
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </>
      )}

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this playlist?">
        <div className="space-y-4 text-sm">
          <p>
            <strong>{playlist.name}</strong> will move to the trash. Nothing is erased yet: you can restore it from
            Playlists for {library.library.settings.trashRetentionDays} days.
          </p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                library.deletePlaylist(id);
                setConfirmDelete(false);
                router.push("/playlists");
              }}
            >
              Move to trash
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function SortableItem({ id, children }: { id: string; children: (handle: React.ReactNode) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      aria-label="Drag to reorder. With the keyboard, press Space, use the arrow keys, then Space again."
      className="flex h-10 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted hover:text-fg active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <GripIcon size={18} />
    </button>
  );
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "relative z-10 rounded-xl bg-raised shadow-xl shadow-black/50" : undefined}
    >
      {children(handle)}
    </li>
  );
}
