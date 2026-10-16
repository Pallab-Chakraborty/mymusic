/**
 * Minimal types and loader for the official YouTube IFrame Player API
 * (https://developers.google.com/youtube/iframe_api_reference).
 * We use the official embedded player as-is: its controls and branding stay visible.
 */

export const enum YTState {
  UNSTARTED = -1,
  ENDED = 0,
  PLAYING = 1,
  PAUSED = 2,
  BUFFERING = 3,
  CUED = 5,
}

export interface YTPlayer {
  loadVideoById(videoId: string): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setVolume(volume: number): void;
  destroy(): void;
}

interface YTPlayerOptions {
  videoId?: string;
  width?: string | number;
  height?: string | number;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (e: { target: YTPlayer }) => void;
    onStateChange?: (e: { data: number; target: YTPlayer }) => void;
    onError?: (e: { data: number; target: YTPlayer }) => void;
  };
}

export interface YTNamespace {
  Player: new (element: HTMLElement, options: YTPlayerOptions) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let loading: Promise<YTNamespace> | null = null;

/** Load YouTube's player script once. Rejects if it cannot be loaded (offline, blocked). */
export function loadYouTubeApi(): Promise<YTNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("browser only"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loading) return loading;

  loading = new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube player did not initialise"));
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      loading = null; // allow another attempt later
      script.remove();
      reject(new Error("Could not load the YouTube player"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Plain-language explanation for the player's error codes. */
export function describePlayerError(code: number): string {
  switch (code) {
    case 100:
      return "This video has been removed or made private.";
    case 101:
    case 150:
      return "The owner of this video doesn't allow it to be played outside YouTube.";
    case 2:
      return "YouTube rejected this video's address.";
    case 5:
      return "YouTube's player hit a problem with this video.";
    default:
      return "This video can't be played right now.";
  }
}
