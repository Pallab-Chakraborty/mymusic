"use client";

import { useEffect } from "react";
import { useAttachHost, usePlayer, usePlayerProgress } from "@/components/providers/PlayerProvider";
import { formatDuration } from "@/lib/format";
import { Equalizer } from "@/components/ui/Equalizer";
import { Thumb } from "@/components/ui/Thumb";
import { thumbnailFor } from "@/lib/thumbnail";
import { Button, IconButton } from "@/components/ui/primitives";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  ExternalIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  QueueIcon,
  RepeatIcon,
  ShuffleIcon,
  TrashIcon,
  VolumeIcon,
} from "@/components/ui/icons";

/**
 * The embedded YouTube player plus its controls.
 *
 * YouTube's rules: the player must stay visible (at least 200x200) with its own
 * controls and branding untouched. So the video is NEVER hidden while a song is
 * loaded. It moves between a small floating window and a large view with CSS only;
 * the same element is kept so playback is never interrupted.
 */
export function PlayerDock() {
  const p = usePlayer();
  const attachHost = useAttachHost();
  const { time, duration } = usePlayerProgress();
  const { current, expanded } = p;

  // Escape closes the expanded view.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") p.setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, p]);

  if (!current) return null;

  const total = duration || current.durationSeconds || 0;
  const pct = total > 0 ? Math.min(100, (time / total) * 100) : 0;

  const hostClass = expanded
    ? "fixed left-1/2 top-[4.25rem] z-[52] aspect-video w-[var(--player-w)] -translate-x-1/2 overflow-hidden bg-black shadow-2xl shadow-black/70 sm:rounded-xl"
    : // Mobile: a full-width 16:9 window docked above the mini bar. Desktop: a floating 356x200 window.
      "fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom)+4.5rem)] z-30 aspect-video min-h-[200px] w-full overflow-hidden bg-black md:inset-x-auto md:bottom-24 md:right-4 md:w-[356px] md:rounded-xl md:shadow-2xl md:shadow-black/70";

  return (
    <>
      {/* The one and only player element. Its position changes, it is never removed while playing. */}
      <div
        ref={attachHost}
        className={`${hostClass} [&_iframe]:h-full [&_iframe]:w-full`}
        aria-label="YouTube video player"
      />

      {!expanded && (
        <section
          aria-label="Mini player"
          className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface/95 backdrop-blur md:bottom-0 md:left-60 md:h-20"
        >
          <div
            role="progressbar"
            aria-label="Playback progress"
            aria-valuemin={0}
            aria-valuemax={Math.round(total)}
            aria-valuenow={Math.round(time)}
            className="h-0.5 w-full bg-line"
          >
            <div className="h-full bg-violet" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex h-[4.25rem] items-center gap-2 px-3 md:h-[4.75rem] md:px-5">
            <Thumb track={current} className="hidden w-16 sm:block" />
            <button
              type="button"
              onClick={() => p.setExpanded(true)}
              className="min-w-0 flex-1 rounded-md px-1 text-left"
              aria-label={`Open player: ${current.title}`}
            >
              <span className="block truncate text-sm font-medium">{current.title}</span>
              <span className="block truncate text-xs text-muted">
                <Status />
              </span>
            </button>
            <Controls compact />
            <IconButton label="Open full player" onClick={() => p.setExpanded(true)}>
              <ChevronUpIcon />
            </IconButton>
            <IconButton label="Stop and close player" onClick={() => p.close()} className="hidden sm:inline-flex">
              <CloseIcon />
            </IconButton>
          </div>
        </section>
      )}

      {expanded && (
        <section
          role="dialog"
          aria-modal="true"
          aria-label="Player"
          className="fixed inset-0 z-[51] flex flex-col overflow-hidden bg-ink"
        >
          {/* Soft glow made from the song's own artwork. Decorative. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbnailFor(current)}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            className="pointer-events-none absolute inset-0 h-full w-full scale-150 object-cover opacity-35 blur-3xl saturate-150"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ink/30 via-ink/70 to-ink"
          />
          <header className="relative flex h-[4.25rem] shrink-0 items-center justify-between px-3 md:px-6">
            <IconButton label="Close full player" onClick={() => p.setExpanded(false)}>
              <ChevronDownIcon />
            </IconButton>
            <p className="text-xs font-medium uppercase tracking-widest text-muted">Now playing</p>
            <IconButton label="Stop and close player" onClick={() => p.close()}>
              <CloseIcon />
            </IconButton>
          </header>

          {/* Space where the (fixed-position) video sits. */}
          <div aria-hidden className="mx-auto w-[var(--player-w)] shrink-0" style={{ aspectRatio: "16 / 9" }} />

          <div className="relative min-h-0 flex-1 overflow-y-auto px-3 pb-[env(safe-area-inset-bottom)] sm:px-0">
            <div className="mx-auto w-[min(100%,760px)]">
              <div className="shrink-0 pt-4">
                <h2 className="line-clamp-2 text-lg font-semibold leading-snug">{current.title}</h2>
                <p className="mt-0.5 truncate text-sm text-muted">{current.channelTitle}</p>
                <p className="mt-1 min-h-5 text-sm">
                  <Status expanded />
                </p>

                <div className="mt-3 flex items-center gap-3 text-xs tabular-nums text-muted">
                  <span className="w-11 text-right">{formatDuration(time) || "0:00"}</span>
                  <input
                    type="range"
                    aria-label="Seek"
                    min={0}
                    max={Math.max(1, Math.round(total))}
                    step={1}
                    value={Math.min(Math.round(time), Math.max(1, Math.round(total)))}
                    disabled={total <= 0}
                    onChange={(e) => p.seek(Number(e.target.value))}
                    className="h-2 flex-1 cursor-pointer accent-violet disabled:cursor-not-allowed"
                  />
                  <span className="w-11">{formatDuration(total) || "–:––"}</span>
                </div>

                <div className="mt-2 flex items-center justify-center gap-1 sm:gap-3">
                  <Controls />
                </div>
                <Volume />
                <p className="mt-1 hidden text-center text-[11px] text-muted md:block">
                  Shortcuts: Space play/pause · ← → skip 5s · N next · P previous · M mute
                </p>
              </div>

              <Queue />

              <p className="shrink-0 py-3 text-center text-[11px] leading-relaxed text-muted">
                Videos play through YouTube&apos;s own player. A video can stop working if its owner removes it or
                blocks embedding, and your phone or browser may pause playback when the screen locks or the tab is in
                the background.
              </p>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

/** Short status line under the title: errors, "tap to play", loading. */
function Status({ expanded = false }: { expanded?: boolean }) {
  const p = usePlayer();
  const { current } = p;
  if (!current) return null;

  if (p.error) {
    return (
      <span role="alert" className="text-danger">
        {p.error.message}
        {expanded && (
          <>
            {" "}
            <a
              href={`https://www.youtube.com/watch?v=${encodeURIComponent(p.error.videoId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline"
            >
              Open on YouTube <ExternalIcon size={13} />
            </a>
          </>
        )}
      </span>
    );
  }
  if (p.needsTap) return <span className="text-warn">Your browser blocked autoplay. Press play to start.</span>;
  if (p.loading) return <span>Loading…</span>;
  return <span>{current.channelTitle}</span>;
}

function Controls({ compact = false }: { compact?: boolean }) {
  const p = usePlayer();
  const size = compact ? 22 : 28;
  return (
    <div className="flex items-center gap-0.5 sm:gap-1">
      {!compact && (
        <IconButton
          label={p.shuffle ? "Shuffle is on" : "Shuffle is off"}
          active={p.shuffle}
          onClick={() => p.setShuffle(!p.shuffle)}
          aria-pressed={p.shuffle}
        >
          <ShuffleIcon />
        </IconButton>
      )}
      <IconButton label="Previous song" onClick={p.previous}>
        <PrevIcon size={size - 4} />
      </IconButton>
      <button
        type="button"
        onClick={p.toggle}
        aria-label={p.playing ? "Pause" : "Play"}
        className={`grid shrink-0 place-items-center rounded-full bg-fg text-ink transition-transform hover:scale-105 ${
          compact ? "h-10 w-10" : "h-14 w-14"
        } ${p.needsTap ? "ring-4 ring-warn/70" : ""}`}
      >
        {p.playing ? <PauseIcon size={size} /> : <PlayIcon size={size} />}
      </button>
      <IconButton label="Next song" onClick={p.next}>
        <NextIcon size={size - 4} />
      </IconButton>
      {!compact && (
        <IconButton
          label={p.repeat === "off" ? "Repeat is off" : p.repeat === "all" ? "Repeat all songs" : "Repeat this song"}
          active={p.repeat !== "off"}
          onClick={p.cycleRepeat}
          className="relative"
        >
          <RepeatIcon />
          {p.repeat === "one" && <span className="absolute right-1 top-1 text-[10px] font-bold">1</span>}
        </IconButton>
      )}
    </div>
  );
}

function Volume() {
  const p = usePlayer();
  return (
    <div className="mx-auto mt-3 flex w-48 items-center gap-2 text-muted">
      <IconButton label={p.volume === 0 ? "Unmute" : "Mute"} onClick={p.toggleMute} className="h-9 w-9">
        <VolumeIcon muted={p.volume === 0} size={20} />
      </IconButton>
      <input
        type="range"
        aria-label="Volume"
        min={0}
        max={100}
        step={1}
        value={p.volume}
        onChange={(e) => p.setVolume(Number(e.target.value))}
        style={{ ["--fill" as string]: `${p.volume}%` }}
        className="range-fill h-1.5 flex-1 cursor-pointer"
      />
    </div>
  );
}

function Queue() {
  const p = usePlayer();
  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col rounded-2xl border border-line bg-surface/70">
      <div className="flex shrink-0 items-center justify-between px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <QueueIcon size={18} /> Queue <span className="font-normal text-muted">({p.queue.length})</span>
        </h3>
        <Button variant="ghost" className="min-h-8 px-2 py-1 text-xs" onClick={p.clearQueue}>
          <TrashIcon size={14} /> Clear &amp; stop
        </Button>
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="Songs in the queue">
        {p.queue.map((t, i) => {
          const isCurrent = i === p.index;
          return (
            <li
              key={`${t.videoId}-${i}`}
              className={`flex items-center gap-1 rounded-lg px-2 py-1.5 ${isCurrent ? "bg-violet/15" : "hover:bg-white/5"}`}
            >
              <button
                type="button"
                onClick={() => p.jumpTo(i)}
                aria-current={isCurrent ? "true" : undefined}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span className="w-5 shrink-0 text-center text-xs tabular-nums text-muted">
                  {isCurrent ? <Equalizer playing={p.playing} className="text-violet" /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className={`block truncate text-sm ${isCurrent ? "font-semibold text-violet" : ""}`}>
                    {t.title}
                  </span>
                  <span className="block truncate text-xs text-muted">{t.channelTitle}</span>
                </span>
              </button>
              <IconButton
                label={`Move ${t.title} up`}
                className="h-8 w-8"
                disabled={i === 0}
                onClick={() => p.moveInQueue(i, i - 1)}
              >
                <ChevronUpIcon size={16} />
              </IconButton>
              <IconButton
                label={`Move ${t.title} down`}
                className="h-8 w-8"
                disabled={i === p.queue.length - 1}
                onClick={() => p.moveInQueue(i, i + 1)}
              >
                <ChevronDownIcon size={16} />
              </IconButton>
              <IconButton
                label={`Remove ${t.title} from the queue`}
                className="h-8 w-8"
                onClick={() => p.removeFromQueue(i)}
              >
                <CloseIcon size={16} />
              </IconButton>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
