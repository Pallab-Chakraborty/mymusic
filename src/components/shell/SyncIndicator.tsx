"use client";

import Link from "next/link";
import { useLibrary } from "@/components/providers/LibraryProvider";
import { timeAgo } from "@/lib/format";
import { AlertIcon, CheckIcon, CloudIcon } from "@/components/ui/icons";

const CONFIG = {
  loading: { label: "Loading…", tone: "text-muted", dot: "bg-muted" },
  saving: { label: "Saving…", tone: "text-blue", dot: "bg-blue animate-pulse" },
  saved: { label: "Saved", tone: "text-ok", dot: "bg-ok" },
  offline: { label: "Offline", tone: "text-warn", dot: "bg-warn" },
  error: { label: "Problem saving", tone: "text-danger", dot: "bg-danger" },
} as const;

/** Always-visible cloud-save status. "Saved" is only shown when nothing is waiting. */
export function SyncIndicator() {
  const lib = useLibrary();
  const c = CONFIG[lib.status];

  let detail = "";
  if (lib.status === "saved")
    detail = lib.lastSyncedAt
      ? `Everything is saved to the cloud. Last checked ${timeAgo(lib.lastSyncedAt)}.`
      : "Everything is saved.";
  if (lib.status === "saving")
    detail = `Saving ${lib.pendingCount} change${lib.pendingCount === 1 ? "" : "s"} to the cloud…`;
  if (lib.status === "offline")
    detail =
      lib.pendingCount > 0
        ? `You're offline. ${lib.pendingCount} change${lib.pendingCount === 1 ? "" : "s"} are kept on this device and will be sent when you're back online.`
        : "You're offline. Showing your last saved copy.";
  if (lib.status === "error") detail = lib.message ?? "Some changes could not be saved.";
  if (lib.status === "loading") detail = "Loading your library…";

  const Icon = lib.status === "error" ? AlertIcon : lib.status === "saved" ? CheckIcon : CloudIcon;

  return (
    <Link
      href="/settings#sync"
      title={detail}
      aria-label={`Cloud save status: ${c.label}. ${detail}`}
      className={`inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium hover:border-violet/50 ${c.tone}`}
    >
      <span aria-hidden className={`h-2 w-2 rounded-full ${c.dot}`} />
      <Icon size={14} />
      <span role="status" aria-live="polite">
        {c.label}
        {lib.status === "saving" && lib.pendingCount > 1 ? ` (${lib.pendingCount})` : ""}
      </span>
    </Link>
  );
}
