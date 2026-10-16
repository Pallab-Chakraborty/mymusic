"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { TrackRow } from "@/components/ui/TrackRow";
import { Button, EmptyState, ErrorBox, PageHeader, SkeletonRows, inputClass } from "@/components/ui/primitives";
import { SearchIcon } from "@/components/ui/icons";
import type { Track } from "@/lib/types";

type Outcome = { kind: "done"; results: Track[] } | { kind: "error"; message: string };
type State = { kind: "idle" } | { kind: "loading" } | Outcome;

const OFFLINE_MESSAGE = "You're offline. Search needs an internet connection; your saved library still works.";

/** Turn the server's answer (or a network failure) into a message a person can act on. */
async function runSearch(q: string, signal: AbortSignal): Promise<Outcome> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return { kind: "error", message: OFFLINE_MESSAGE };
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal, cache: "no-store" });
    if (res.status === 401) {
      return { kind: "error", message: "Your session has expired. Please sign in again." };
    }
    const body = (await res.json().catch(() => null)) as { results?: Track[]; message?: string } | null;
    if (!res.ok) {
      return { kind: "error", message: body?.message ?? "Search is temporarily unavailable. Please try again." };
    }
    return { kind: "done", results: body?.results ?? [] };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { kind: "error", message: "Couldn't reach the server. Check your connection and try again." };
  }
}

export function SearchView() {
  const params = useSearchParams();
  const q = (params.get("q") ?? "").trim();

  const [input, setInput] = useState(q);
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<{ key: string; result: Outcome } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the box in sync when the address changes (back button, quick search on Home).
  const [seenQ, setSeenQ] = useState(q);
  if (q !== seenQ) {
    setSeenQ(q);
    setInput(q);
  }

  // What is on screen is worked out from the search being asked for and the answer received for it.
  const key = `${q}#${attempt}`;
  const state: State = !q ? { kind: "idle" } : outcome?.key === key ? outcome.result : { kind: "loading" };

  useEffect(() => {
    if (!q) return;
    const controller = new AbortController();
    runSearch(q, controller.signal)
      .then((result) => setOutcome({ key: `${q}#${attempt}`, result }))
      .catch(() => {
        /* aborted by a newer search */
      });
    return () => controller.abort();
  }, [q, attempt]);

  const submit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const next = input.trim();
      if (!next) return;
      if (next === q) setAttempt((n) => n + 1);
      else {
        // Update the address without asking the server for a new page: instant, and it works offline.
        window.history.pushState(null, "", `/search?q=${encodeURIComponent(next)}`);
      }
    },
    [input, q],
  );

  return (
    <>
      <PageHeader title="Search" subtitle="Search public YouTube videos, then add the ones you love to a playlist." />

      <form onSubmit={submit} role="search" className="mb-6 flex gap-2">
        <label htmlFor="search-box" className="sr-only">
          Search YouTube
        </label>
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" size={18} />
          <input
            id="search-box"
            ref={inputRef}
            type="search"
            value={input}
            maxLength={100}
            autoFocus={!q}
            placeholder="Song, artist or album"
            onChange={(e) => setInput(e.target.value)}
            className={`${inputClass} pl-10`}
          />
        </div>
        <Button type="submit" variant="primary" disabled={!input.trim()}>
          Search
        </Button>
      </form>

      <div aria-live="polite">
        {state.kind === "idle" && (
          <EmptyState title="Find a song">
            Type a song, artist or album above. Results come straight from YouTube. Nothing is saved until you add it to
            a playlist.
          </EmptyState>
        )}

        {state.kind === "loading" && <SkeletonRows count={6} />}

        {state.kind === "error" && (
          <ErrorBox
            action={
              <Button onClick={() => setAttempt((n) => n + 1)} className="min-h-9 px-3 py-1.5">
                Try again
              </Button>
            }
          >
            {state.message}
          </ErrorBox>
        )}

        {state.kind === "done" &&
          (state.results.length === 0 ? (
            <EmptyState title={`No results for “${q}”`}>
              Try different words, or check the spelling. Videos that can&apos;t be played outside YouTube are left out.
            </EmptyState>
          ) : (
            <>
              <p className="mb-2 text-sm text-muted">
                {state.results.length} results for “{q}”
              </p>
              <ul className="space-y-1">
                {state.results.map((t) => (
                  <li key={t.videoId}>
                    <TrackRow track={t} context={state.results} />
                  </li>
                ))}
              </ul>
            </>
          ))}
      </div>
    </>
  );
}
