import { thumbnailFor } from "@/lib/thumbnail";
import type { Track } from "@/lib/types";

/**
 * Song artwork. A plain <img> is used on purpose: YouTube thumbnails are
 * already optimised, and this keeps the page fast without an image proxy.
 */
export function Thumb({
  track,
  className = "",
}: {
  track: Pick<Track, "videoId" | "thumbnailUrl">;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={thumbnailFor(track)}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={`aspect-video shrink-0 rounded-lg bg-raised object-cover ${className}`}
    />
  );
}

/** A 2x2 collage of up to four song covers, used as a playlist cover. */
export function PlaylistCover({ tracks, className = "" }: { tracks: Track[]; className?: string }) {
  const shown = tracks.slice(0, 4);
  if (shown.length === 0) {
    return (
      <div
        className={`grid aspect-square place-items-center rounded-xl bg-gradient-to-br from-[#2b2457] to-[#162a52] text-violet ${className}`}
        aria-hidden="true"
      >
        <svg
          width="34%"
          height="34%"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 18V6l11-2v12" />
          <circle cx="6.5" cy="18" r="2.5" />
          <circle cx="17.5" cy="16" r="2.5" />
        </svg>
      </div>
    );
  }
  if (shown.length < 4) {
    return (
      <div className={`aspect-square overflow-hidden rounded-xl bg-raised ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbnailFor(shown[0])}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-full w-full scale-[1.34] object-cover"
        />
      </div>
    );
  }
  return (
    <div className={`grid aspect-square grid-cols-2 grid-rows-2 overflow-hidden rounded-xl bg-raised ${className}`}>
      {shown.map((t) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={t.videoId}
          src={thumbnailFor(t)}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      ))}
    </div>
  );
}
