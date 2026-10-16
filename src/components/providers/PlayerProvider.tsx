"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RepeatMode, Track } from "@/lib/types";
import { insertNext, moveItem, pickNext, pickPrevious, removeAt } from "@/lib/player/queue";
import { describePlayerError, loadYouTubeApi, YTState, type YTPlayer } from "@/lib/player/youtube";
import { thumbnailFor } from "@/lib/thumbnail";
import { useLibrary } from "./LibraryProvider";
import { useToast } from "./ToastProvider";

export interface PlayerError {
  message: string;
  videoId: string;
}

interface PlayerApi {
  queue: Track[];
  index: number;
  current: Track | null;
  playing: boolean;
  loading: boolean;
  error: PlayerError | null;
  /** The browser blocked autoplay: the user must press play. */
  needsTap: boolean;
  expanded: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  /** 0 to 100. */
  volume: number;
  setVolume(value: number): void;
  toggleMute(): void;
  setExpanded(value: boolean): void;
  /** Play one song. Pass the surrounding list to keep playing through it. */
  playTrack(track: Track, context?: Track[]): void;
  playQueue(tracks: Track[], startIndex?: number): void;
  enqueue(track: Track): void;
  playNextTrack(track: Track): void;
  jumpTo(index: number): void;
  removeFromQueue(index: number): void;
  moveInQueue(from: number, to: number): void;
  clearQueue(): void;
  next(): void;
  previous(): void;
  toggle(): void;
  seek(seconds: number): void;
  setShuffle(value: boolean): void;
  cycleRepeat(): void;
  close(): void;
  /** Attach the element the YouTube player is drawn into. */
  attachHost(el: HTMLDivElement | null): void;
}

const PlayerContext = createContext<PlayerApi | null>(null);
const HostContext = createContext<(el: HTMLDivElement | null) => void>(() => {});
const ProgressContext = createContext<{ time: number; duration: number }>({ time: 0, duration: 0 });

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}

/** Callback ref for the element the YouTube player is drawn into. */
export function useAttachHost() {
  return useContext(HostContext);
}

/** Playback position. Kept separate so the whole app doesn't redraw twice a second. */
export function usePlayerProgress() {
  return useContext(ProgressContext);
}

const AUTO_SKIP_MS = 2500;
const AUTOPLAY_CHECK_MS = 3500;

export function PlayerProvider({ children }: { children: ReactNode }) {
  const library = useLibrary();
  const toast = useToast();
  const { shuffle, repeatMode: repeat } = library.library.settings;

  const [queue, setQueue] = useState<Track[]>([]);
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<PlayerError | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [progress, setProgress] = useState({ time: 0, duration: 0 });
  const [loadNonce, setLoadNonce] = useState(0);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [volume, setVolumeState] = useState<number>(() => {
    try {
      const saved = Number(window.localStorage.getItem("mymusic:volume"));
      return Number.isFinite(saved) && saved >= 0 && saved <= 100 && saved !== 0 ? saved : 100;
    } catch {
      return 100;
    }
  });
  const volumeRef = useRef(volume);
  const lastAudibleRef = useRef(volume > 0 ? volume : 100);
  const queueRef = useRef<{ queue: Track[]; index: number }>({ queue: [], index: -1 });
  const historyRef = useRef<number[]>([]);
  const settingsRef = useRef({ shuffle, repeat });
  const recordedRef = useRef<string | null>(null);
  const errorStreakRef = useRef(0);
  const timersRef = useRef<{ tap?: ReturnType<typeof setTimeout>; skip?: ReturnType<typeof setTimeout> }>({});
  const libraryRef = useRef(library);
  const toastRef = useRef(toast);

  // Keep "latest value" refs current. Done after render (not during it) as React requires.
  useLayoutEffect(() => {
    settingsRef.current = { shuffle, repeat };
    libraryRef.current = library;
    toastRef.current = toast;
  });

  const current = index >= 0 ? (queue[index] ?? null) : null;

  const clearTimers = useCallback(() => {
    clearTimeout(timersRef.current.tap);
    clearTimeout(timersRef.current.skip);
    timersRef.current = {};
  }, []);

  /** Single place that changes the queue, so the ref and the screen never disagree. */
  const commit = useCallback((nextQueue: Track[], nextIndex: number) => {
    queueRef.current = { queue: nextQueue, index: nextIndex };
    setQueue(nextQueue);
    setIndex(nextIndex);
  }, []);

  const goTo = useCallback(
    (nextIndex: number, options: { pushHistory?: boolean } = {}) => {
      const { queue: q, index: i } = queueRef.current;
      if (nextIndex < 0 || nextIndex >= q.length) return;
      clearTimers();
      if (options.pushHistory !== false && i >= 0 && i !== nextIndex) {
        historyRef.current = [...historyRef.current, i].slice(-200);
      }
      if (nextIndex === i) {
        // Same song again (repeat one, or retry): restart it.
        recordedRef.current = null;
        setError(null);
        const p = playerRef.current;
        if (p) {
          p.seekTo(0, true);
          p.playVideo();
        } else {
          setLoadNonce((n) => n + 1);
        }
        return;
      }
      commit(q, nextIndex);
    },
    [clearTimers, commit],
  );

  const advance = useCallback(
    (manual: boolean) => {
      const { queue: q, index: i } = queueRef.current;
      const { shuffle: s, repeat: r } = settingsRef.current;
      const next = pickNext({ length: q.length, index: i, shuffle: s, repeat: r, manual, history: historyRef.current });
      if (next === null) {
        setPlaying(false);
        return;
      }
      goTo(next);
    },
    [goTo],
  );

  const handlePlayerError = useCallback(
    (code: number) => {
      const { queue: q, index: i } = queueRef.current;
      const track = q[i];
      if (!track) return;
      clearTimers();
      setPlaying(false);
      setLoading(false);
      setNeedsTap(false);
      setError({ message: describePlayerError(code), videoId: track.videoId });

      errorStreakRef.current += 1;
      const canSkip = q.length > 1 && errorStreakRef.current < q.length;
      if (canSkip) {
        timersRef.current.skip = setTimeout(() => {
          toastRef.current.show(`Skipped "${track.title}". It can't be played here.`, { kind: "info" });
          advance(true);
        }, AUTO_SKIP_MS);
      }
    },
    [advance, clearTimers],
  );

  // Latest handlers for the YouTube callbacks (which are created only once).
  const handlersRef = useRef({ advance, handlePlayerError });
  useLayoutEffect(() => {
    handlersRef.current = { advance, handlePlayerError };
  });

  const startAutoplayWatch = useCallback(() => {
    clearTimeout(timersRef.current.tap);
    timersRef.current.tap = setTimeout(() => {
      const state = playerRef.current?.getPlayerState();
      if (state !== YTState.PLAYING && state !== YTState.BUFFERING) setNeedsTap(true);
    }, AUTOPLAY_CHECK_MS);
  }, []);

  // Create the player the first time, then just load new videos into it.
  const videoId = current?.videoId ?? null;

  // When a different song (or a retry of the same one) starts, reset the per-song state.
  // Done while rendering, which is React's recommended way to reset state on a change.
  const loadKey = videoId ? `${videoId}:${loadNonce}` : null;
  const [seenLoadKey, setSeenLoadKey] = useState<string | null>(null);
  if (loadKey !== seenLoadKey) {
    setSeenLoadKey(loadKey);
    if (loadKey) {
      setError(null);
      setNeedsTap(false);
      setLoading(true);
      setProgress({ time: 0, duration: 0 });
    }
  }

  useEffect(() => {
    if (!videoId) return;
    let cancelled = false;

    loadYouTubeApi()
      .then((YT) => {
        if (cancelled) return;
        startAutoplayWatch();

        if (playerRef.current) {
          playerRef.current.loadVideoById(videoId);
          return;
        }
        const host = hostRef.current;
        if (!host) return;
        const mount = document.createElement("div");
        host.replaceChildren(mount);
        playerRef.current = new YT.Player(mount, {
          width: "100%",
          height: "100%",
          videoId,
          playerVars: {
            autoplay: 1,
            playsinline: 1,
            rel: 0,
            enablejsapi: 1,
            origin: window.location.origin,
          },
          events: {
            onStateChange: (e) => {
              switch (e.data) {
                case YTState.PLAYING: {
                  e.target.setVolume(volumeRef.current);
                  clearTimeout(timersRef.current.tap);
                  setPlaying(true);
                  setLoading(false);
                  setNeedsTap(false);
                  setError(null);
                  errorStreakRef.current = 0;
                  const track = queueRef.current.queue[queueRef.current.index];
                  if (track && recordedRef.current !== track.videoId) {
                    recordedRef.current = track.videoId;
                    libraryRef.current.recordPlay(track);
                  }
                  break;
                }
                case YTState.PAUSED:
                  setPlaying(false);
                  break;
                case YTState.BUFFERING:
                  setLoading(true);
                  break;
                case YTState.ENDED:
                  setPlaying(false);
                  handlersRef.current.advance(false);
                  break;
              }
            },
            onError: (e) => handlersRef.current.handlePlayerError(e.data),
          },
        });
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        setError({
          message: "The YouTube player couldn't load. Check your connection, then try again.",
          videoId,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [videoId, loadNonce, startAutoplayWatch]);

  // Playback position, twice a second while playing.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      const time = p.getCurrentTime?.() ?? 0;
      const duration = p.getDuration?.() ?? 0;
      setProgress((prev) =>
        Math.abs(prev.time - time) < 0.25 && prev.duration === duration ? prev : { time, duration },
      );
    }, 500);
    return () => clearInterval(id);
  }, [playing]);

  const destroyPlayer = useCallback(() => {
    clearTimers();
    try {
      playerRef.current?.destroy();
    } catch {
      // already gone
    }
    playerRef.current = null;
    hostRef.current?.replaceChildren();
  }, [clearTimers]);

  useEffect(() => () => destroyPlayer(), [destroyPlayer]);

  // ----- public actions ------------------------------------------------------

  const playQueue = useCallback(
    (tracks: Track[], startIndex = 0) => {
      if (tracks.length === 0) return;
      const start = Math.min(Math.max(startIndex, 0), tracks.length - 1);
      historyRef.current = [];
      errorStreakRef.current = 0;
      recordedRef.current = null;
      clearTimers();
      const sameVideo = queueRef.current.queue[queueRef.current.index]?.videoId === tracks[start].videoId;
      commit(tracks, start);
      if (sameVideo) setLoadNonce((n) => n + 1);
    },
    [clearTimers, commit],
  );

  const playTrack = useCallback(
    (track: Track, context?: Track[]) => {
      if (context && context.length > 0) {
        const i = context.findIndex((t) => t.videoId === track.videoId);
        playQueue(context, i >= 0 ? i : 0);
        return;
      }
      playQueue([track], 0);
    },
    [playQueue],
  );

  const enqueue = useCallback(
    (track: Track) => {
      const { queue: q } = queueRef.current;
      if (q.length === 0) {
        playQueue([track], 0);
        return;
      }
      commit([...q, track], queueRef.current.index);
      toastRef.current.show("Added to queue", { kind: "info" });
    },
    [commit, playQueue],
  );

  const playNextTrack = useCallback(
    (track: Track) => {
      const { queue: q, index: i } = queueRef.current;
      if (q.length === 0) {
        playQueue([track], 0);
        return;
      }
      commit(insertNext(q, i, track).tracks, i);
      toastRef.current.show("Will play next", { kind: "info" });
    },
    [commit, playQueue],
  );

  const jumpTo = useCallback((i: number) => goTo(i), [goTo]);

  const removeFromQueue = useCallback(
    (i: number) => {
      const { queue: q, index: cur } = queueRef.current;
      if (i === cur) {
        // Removing the song that is playing: move on to the next one, or stop.
        if (q.length === 1) {
          destroyPlayer();
          commit([], -1);
          setPlaying(false);
          return;
        }
        const nextIndex = i < q.length - 1 ? i : i - 1;
        const result = removeAt(q, cur, i);
        clearTimers();
        historyRef.current = [];
        recordedRef.current = null;
        commit(result.tracks, nextIndex);
        setLoadNonce((n) => n + 1);
        return;
      }
      const result = removeAt(q, cur, i);
      historyRef.current = [];
      commit(result.tracks, result.index);
    },
    [clearTimers, commit, destroyPlayer],
  );

  const moveInQueue = useCallback(
    (from: number, to: number) => {
      const { queue: q, index: cur } = queueRef.current;
      const result = moveItem(q, cur, from, to);
      historyRef.current = [];
      commit(result.tracks, result.index);
    },
    [commit],
  );

  const close = useCallback(() => {
    destroyPlayer();
    commit([], -1);
    historyRef.current = [];
    setPlaying(false);
    setLoading(false);
    setError(null);
    setNeedsTap(false);
    setExpanded(false);
    setProgress({ time: 0, duration: 0 });
  }, [commit, destroyPlayer]);

  const next = useCallback(() => advance(true), [advance]);

  const previous = useCallback(() => {
    const p = playerRef.current;
    if (p && (p.getCurrentTime?.() ?? 0) > 3) {
      p.seekTo(0, true);
      return;
    }
    const { queue: q, index: i } = queueRef.current;
    const result = pickPrevious({
      length: q.length,
      index: i,
      repeat: settingsRef.current.repeat,
      history: historyRef.current,
    });
    if (!result) {
      p?.seekTo(0, true);
      return;
    }
    historyRef.current = result.history;
    goTo(result.index, { pushHistory: false });
  }, [goTo]);

  const toggle = useCallback(() => {
    const p = playerRef.current;
    if (!p) {
      if (queueRef.current.queue.length > 0) setLoadNonce((n) => n + 1);
      return;
    }
    // A user tap is exactly what browsers require to allow playback.
    setNeedsTap(false);
    if (p.getPlayerState() === YTState.PLAYING) p.pauseVideo();
    else {
      clearTimeout(timersRef.current.skip);
      p.playVideo();
    }
  }, []);

  const seek = useCallback((seconds: number) => {
    playerRef.current?.seekTo(seconds, true);
    setProgress((prev) => ({ ...prev, time: seconds }));
  }, []);

  const setVolume = useCallback((value: number) => {
    const v = Math.max(0, Math.min(100, Math.round(value)));
    volumeRef.current = v;
    if (v > 0) lastAudibleRef.current = v;
    setVolumeState(v);
    playerRef.current?.setVolume(v);
    try {
      window.localStorage.setItem("mymusic:volume", String(v));
    } catch {
      // private mode: the volume just isn't remembered
    }
  }, []);

  const toggleMute = useCallback(() => {
    setVolume(volumeRef.current > 0 ? 0 : lastAudibleRef.current);
  }, [setVolume]);

  const setShuffle = useCallback((value: boolean) => libraryRef.current.updateSettings({ shuffle: value }), []);
  const cycleRepeat = useCallback(() => {
    const order: RepeatMode[] = ["off", "all", "one"];
    const nextMode = order[(order.indexOf(settingsRef.current.repeat) + 1) % order.length];
    libraryRef.current.updateSettings({ repeatMode: nextMode });
  }, []);

  const attachHost = useCallback((el: HTMLDivElement | null) => {
    hostRef.current = el;
  }, []);

  // Keyboard shortcuts (ignored while typing or when a button/link has focus):
  // Space play/pause, Left/Right seek 5 seconds, N next, P previous, M mute.
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      const onControl = tag === "BUTTON" || tag === "A" || tag === "SUMMARY";
      switch (e.key) {
        case " ":
          if (onControl) return;
          e.preventDefault();
          toggle();
          break;
        case "ArrowRight":
        case "ArrowLeft": {
          const p = playerRef.current;
          if (!p) return;
          e.preventDefault();
          seek(Math.max(0, p.getCurrentTime() + (e.key === "ArrowRight" ? 5 : -5)));
          break;
        }
        case "n":
        case "N":
          next();
          break;
        case "p":
        case "P":
          previous();
          break;
        case "m":
        case "M":
          toggleMute();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, toggle, seek, next, previous, toggleMute]);

  // Lock-screen / headphone / keyboard media keys, where the browser supports them.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    if (!current) {
      ms.metadata = null;
      return;
    }
    ms.metadata = new MediaMetadata({
      title: current.title,
      artist: current.channelTitle,
      artwork: [{ src: thumbnailFor(current), sizes: "480x360", type: "image/jpeg" }],
    });
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // not supported in this browser
      }
    };
    set("play", () => toggle());
    set("pause", () => toggle());
    set("nexttrack", () => next());
    set("previoustrack", () => previous());
    set("seekto", (d) => {
      if (typeof d.seekTime === "number") seek(d.seekTime);
    });
  }, [current, toggle, next, previous, seek]);

  useEffect(() => {
    if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
      navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    }
  }, [playing]);

  const api = useMemo<PlayerApi>(
    () => ({
      queue,
      index,
      current,
      playing,
      loading,
      error,
      needsTap,
      expanded,
      shuffle,
      repeat,
      volume,
      setVolume,
      toggleMute,
      setExpanded,
      playTrack,
      playQueue,
      enqueue,
      playNextTrack,
      jumpTo,
      removeFromQueue,
      moveInQueue,
      clearQueue: close,
      next,
      previous,
      toggle,
      seek,
      setShuffle,
      cycleRepeat,
      close,
      attachHost,
    }),
    [
      queue,
      index,
      current,
      playing,
      loading,
      error,
      needsTap,
      expanded,
      shuffle,
      repeat,
      volume,
      setVolume,
      toggleMute,
      playTrack,
      playQueue,
      enqueue,
      playNextTrack,
      jumpTo,
      removeFromQueue,
      moveInQueue,
      next,
      previous,
      toggle,
      seek,
      setShuffle,
      cycleRepeat,
      close,
      attachHost,
    ],
  );

  return (
    <PlayerContext.Provider value={api}>
      <HostContext.Provider value={attachHost}>
        <ProgressContext.Provider value={progress}>{children}</ProgressContext.Provider>
      </HostContext.Provider>
    </PlayerContext.Provider>
  );
}
