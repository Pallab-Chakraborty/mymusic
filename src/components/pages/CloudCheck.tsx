"use client";

import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { createClient } from "@/lib/supabase/client";

interface Step {
  name: string;
  state: "wait" | "ok" | "fail";
  detail?: string;
}

const STEP_NAMES = [
  "You are signed in",
  "Read your playlists",
  "Read your settings",
  "Create a test playlist",
  "Add a test song",
  "Remove the test playlist",
];

const TIMEOUT_MS = 15_000;

function withTimeout<T>(p: PromiseLike<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("No answer after 15 seconds (the request hung)")), TIMEOUT_MS);
    Promise.resolve(p).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Safe to show: only the status, code and message the database returned. No keys or tokens. */
function describeError(e: unknown, status?: number): string {
  const x = (e ?? {}) as { message?: string; code?: string; details?: string; hint?: string };
  const parts = [
    status ? `status ${status}` : "",
    x.code ? `code ${x.code}` : "",
    x.message ?? (e instanceof Error ? e.message : String(e)),
    x.details ?? "",
    x.hint ?? "",
  ].filter(Boolean);
  return parts.join(" · ").slice(0, 400);
}

/** Tries each part of cloud saving once and says which one fails. Leaves nothing behind. */
export function CloudCheck() {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    const results: Step[] = STEP_NAMES.map((name) => ({ name, state: "wait" }));
    const show = () => setSteps(results.map((s) => ({ ...s })));
    show();

    async function step(i: number, fn: () => Promise<string | void>) {
      try {
        const detail = await withTimeout(fn());
        results[i] = { ...results[i], state: "ok", detail: detail ?? undefined };
      } catch (e) {
        results[i] = { ...results[i], state: "fail", detail: describeError(e) };
      }
      show();
    }

    const supabase = createClient();
    const testId = crypto.randomUUID();
    let created = false;

    await step(0, async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) throw error ?? new Error("Not signed in");
    });
    await step(1, async () => {
      const { error, status } = await supabase.from("playlists").select("id").limit(1);
      if (error) throw Object.assign(new Error(describeError(error, status)), {});
    });
    await step(2, async () => {
      const { error, status } = await supabase.from("user_settings").select("user_id").limit(1);
      if (error) throw new Error(describeError(error, status));
    });
    await step(3, async () => {
      const { error, status } = await supabase.rpc("create_playlist", {
        p_id: testId,
        p_name: "Cloud test (safe to ignore)",
      });
      if (error) throw new Error(describeError(error, status));
      created = true;
    });
    if (created) {
      await step(4, async () => {
        const { error, status } = await supabase.rpc("add_track_to_playlist", {
          p_playlist_id: testId,
          p_video_id: "cloudtest01",
          p_title: "Test song",
          p_channel_title: "Test",
          p_thumbnail_url: null,
          p_duration_seconds: 60,
        });
        if (error) throw new Error(describeError(error, status));
      });
      await step(5, async () => {
        const soft = await supabase.from("playlists").update({ deleted_at: new Date().toISOString() }).eq("id", testId);
        if (soft.error) throw new Error(describeError(soft.error, soft.status));
        const del = await supabase.from("playlists").delete().eq("id", testId);
        if (del.error) throw new Error(describeError(del.error, del.status));
      });
    } else {
      results[4] = { ...results[4], state: "fail", detail: "Skipped because the test playlist could not be created." };
      results[5] = { ...results[5], state: "fail", detail: "Skipped." };
      show();
    }
    setRunning(false);
  }

  const allOk = steps?.every((s) => s.state === "ok");
  return (
    <div className="space-y-3">
      <Button onClick={run} disabled={running}>
        {running ? "Testing…" : "Test cloud connection"}
      </Button>
      {steps && (
        <div className="rounded-xl border border-line p-3" role="status">
          <ul className="space-y-2">
            {steps.map((s) => (
              <li key={s.name} className="flex gap-2">
                <span
                  aria-hidden="true"
                  className={s.state === "ok" ? "text-ok" : s.state === "fail" ? "text-danger" : "text-muted"}
                >
                  {s.state === "ok" ? "✓" : s.state === "fail" ? "✗" : "…"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block">
                    {s.name}
                    <span className="sr-only">
                      : {s.state === "ok" ? "worked" : s.state === "fail" ? "failed" : "waiting"}
                    </span>
                  </span>
                  {s.detail && <span className="block break-words text-xs text-muted">{s.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
          {allOk && <p className="mt-3 font-medium text-ok">Everything works. Saving to the cloud is possible.</p>}
        </div>
      )}
    </div>
  );
}
