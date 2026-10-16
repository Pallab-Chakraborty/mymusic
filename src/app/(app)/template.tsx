import type { ReactNode } from "react";

/** A template is re-created on every page change, which replays the short entrance animation. */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
