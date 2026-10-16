/** Small animated bars shown on the song that is playing. Decorative only: not tied to the actual audio. */
export function Equalizer({ playing, className = "" }: { playing: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-4 items-end gap-[2px] ${playing ? "" : "eq-paused"} ${className}`}
    >
      <span className="eq-bar" style={{ animationDelay: "0s" }} />
      <span className="eq-bar" style={{ animationDelay: "0.25s" }} />
      <span className="eq-bar" style={{ animationDelay: "0.5s" }} />
      <span className="eq-bar" style={{ animationDelay: "0.15s" }} />
    </span>
  );
}
