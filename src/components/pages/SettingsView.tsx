"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLibrary } from "@/components/providers/LibraryProvider";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { CloudCheck } from "./CloudCheck";
import { TrashList } from "@/components/ui/TrashList";
import { Button, ErrorBox, PageHeader, inputClass } from "@/components/ui/primitives";
import { DownloadIcon, UploadIcon } from "@/components/ui/icons";
import { createClient } from "@/lib/supabase/client";
import { buildExport, MAX_IMPORT_BYTES } from "@/lib/exportImport";
import { downloadText } from "@/lib/download";
import { timeAgo } from "@/lib/format";

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id ?? title}-h`}
      className="scroll-mt-20 rounded-2xl border border-line bg-surface p-5"
    >
      <h2 id={`${id ?? title}-h`} className="mb-3 text-lg font-semibold">
        {title}
      </h2>
      <div className="space-y-4 text-sm">{children}</div>
    </section>
  );
}

export function SettingsView() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-6">
        <SyncSection />
        <BackupSection />
        <TrashSection />
        <AccountSection />
        <AboutSection />
      </div>
    </>
  );
}

function SyncSection() {
  const lib = useLibrary();
  const [checking, setChecking] = useState(false);

  const label = {
    loading: "Loading…",
    saved: "Everything is saved to the cloud.",
    saving: `Saving ${lib.pendingCount} change${lib.pendingCount === 1 ? "" : "s"}…`,
    offline: "You're offline.",
    error: "Some changes could not be saved.",
  }[lib.status];

  return (
    <Section id="sync" title="Cloud saving">
      <p>
        <strong>{label}</strong>
        {lib.lastSyncedAt && lib.status !== "loading" && (
          <span className="text-muted"> Last checked {timeAgo(lib.lastSyncedAt)}.</span>
        )}
      </p>
      {lib.fromCache && lib.loaded && (
        <p className="text-muted">Showing the copy saved on this device while the cloud copy loads.</p>
      )}
      {lib.status === "offline" && lib.pendingCount > 0 && (
        <p className="text-muted">
          {lib.pendingCount} change{lib.pendingCount === 1 ? " is" : "s are"} stored on this device and will be sent
          automatically when you&apos;re back online. Keep this page or app open until it says Saved.
        </p>
      )}
      {lib.message && lib.status !== "saved" && <ErrorBox>{lib.message}</ErrorBox>}

      {lib.failed.length > 0 && (
        <div>
          <h3 className="mb-2 font-medium">Changes the server refused</h3>
          <ul className="space-y-2">
            {lib.failed.map((f) => (
              <li
                key={f.opId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-danger/30 p-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{describeOp(f.op.type)}</span>
                  <span className="text-muted">{f.error}</span>
                </span>
                <span className="flex gap-2">
                  <Button className="min-h-9 px-3 py-1.5" onClick={() => void lib.retryFailed(f.opId)}>
                    Try again
                  </Button>
                  <Button variant="ghost" className="min-h-9 px-3 py-1.5" onClick={() => lib.discardFailed(f.opId)}>
                    Discard
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button
        disabled={checking}
        onClick={async () => {
          setChecking(true);
          await lib.refresh();
          setChecking(false);
        }}
      >
        {checking ? "Checking…" : "Check the cloud now"}
      </Button>

      <CloudCheck />

      <div className="rounded-xl bg-raised p-4 text-muted">
        <p className="mb-2 font-medium text-fg">Saving, backups and exports are three different things</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong className="text-fg">Saving (persistence):</strong> every change is written to your cloud database.
            It is what lets you see the same playlists on your phone and computer.
          </li>
          <li>
            <strong className="text-fg">Database backups:</strong> copies of the whole database made by your hosting
            provider. Whether they exist, and for how long, depends on your Supabase plan. The free plan does not
            promise independent backups, so don&apos;t rely on it alone.
          </li>
          <li>
            <strong className="text-fg">Exports:</strong> a file you download and keep yourself. It is the only copy
            that doesn&apos;t depend on any company. Export regularly.
          </li>
        </ul>
      </div>
    </Section>
  );
}

function describeOp(type: string) {
  const names: Record<string, string> = {
    createPlaylist: "Create a playlist",
    renamePlaylist: "Rename a playlist",
    softDeletePlaylist: "Delete a playlist",
    restorePlaylist: "Restore a playlist",
    permanentDeletePlaylist: "Delete a playlist forever",
    addTrack: "Add a song",
    removeTrack: "Remove a song",
    reorderTracks: "Change song order",
    duplicatePlaylist: "Duplicate a playlist",
    recordPlay: "Record a play",
    updateSettings: "Save settings",
  };
  return names[type] ?? "A change";
}

function BackupSection() {
  const lib = useLibrary();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  function exportAll() {
    if (lib.playlists.length === 0) {
      setResult({ ok: false, text: "You have no playlists to export yet." });
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`mymusic-backup-${stamp}.json`, buildExport(lib.playlists), "application/json");
    setResult({
      ok: true,
      text: `Downloaded a backup of ${lib.playlists.length} playlist${lib.playlists.length === 1 ? "" : "s"}. Keep the file somewhere safe.`,
    });
  }

  async function importFile(file: File) {
    setResult(null);
    if (file.size > MAX_IMPORT_BYTES) {
      setResult({ ok: false, text: "That file is too large (limit 2 MB)." });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: await file.text(),
      });
      const body = (await res.json().catch(() => null)) as {
        imported?: { name: string; tracks: number }[];
        failed?: { name: string }[];
        error?: string;
      } | null;
      if (!res.ok && !body?.imported?.length) {
        setResult({ ok: false, text: body?.error ?? "The import didn't work. Nothing was changed." });
      } else {
        const done = body?.imported ?? [];
        const bad = body?.failed ?? [];
        await lib.refresh();
        setResult({
          ok: bad.length === 0,
          text:
            `Imported ${done.length} playlist${done.length === 1 ? "" : "s"} (${done.reduce((s, p) => s + p.tracks, 0)} songs).` +
            (bad.length ? ` ${bad.length} could not be saved: ${bad.map((b) => b.name).join(", ")}.` : ""),
        });
      }
    } catch {
      setResult({ ok: false, text: "Couldn't reach the server. Nothing was imported. Please try again." });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Section id="backup" title="Export and restore">
      <p className="text-muted">
        Download all your playlists as a file you keep yourself. To restore, import that file. Imported playlists are
        added as new playlists, so nothing you already have is overwritten.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={exportAll}>
          <DownloadIcon size={16} /> Export all playlists (JSON)
        </Button>
        <Button disabled={busy} onClick={() => fileRef.current?.click()}>
          <UploadIcon size={16} /> {busy ? "Importing…" : "Import from a backup file"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label="Choose a MyMusic backup file"
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
          }}
        />
      </div>
      {result &&
        (result.ok ? (
          <p role="status" className="rounded-lg border border-ok/40 bg-ok/10 px-3 py-2">
            {result.text}
          </p>
        ) : (
          <ErrorBox>{result.text}</ErrorBox>
        ))}
      <p className="text-muted">
        Each playlist&apos;s page also has <em>Export JSON</em> and <em>Export M3U</em>. M3U files keep the YouTube link
        of every song, plus a <code className="rounded bg-ink px-1">#MYMUSIC:videoId=</code> line that MyMusic reads.
      </p>
    </Section>
  );
}

function TrashSection() {
  const lib = useLibrary();
  const days = lib.library.settings.trashRetentionDays;
  const [value, setValue] = useState(String(days));
  const [seenDays, setSeenDays] = useState(days);
  if (days !== seenDays) {
    // The saved value changed (for example from another device): show it.
    setSeenDays(days);
    setValue(String(days));
  }

  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 1 && n <= 365;

  function save(e: FormEvent) {
    e.preventDefault();
    if (valid && n !== days) lib.updateSettings({ trashRetentionDays: n });
  }

  return (
    <Section id="trash" title="Deleted playlists">
      <p className="text-muted">
        Deleting a playlist moves it to the trash first. It can be restored until the time below runs out, and is then
        erased automatically.
      </p>
      <form onSubmit={save} className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="retention" className="mb-1 block font-medium">
            Keep deleted playlists for (days)
          </label>
          <input
            id="retention"
            type="number"
            min={1}
            max={365}
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={!valid}
            className={`${inputClass} w-32`}
          />
        </div>
        <Button type="submit" disabled={!valid || n === days}>
          Save
        </Button>
        {!valid && <p className="basis-full text-danger">Enter a whole number from 1 to 365.</p>}
      </form>
      {lib.trash.length > 0 ? <TrashList /> : <p className="text-muted">The trash is empty.</p>}
    </Section>
  );
}

interface Identity {
  provider: string;
}

function AccountSection() {
  const lib = useLibrary();
  const [email, setEmail] = useState<string | null>(null);
  const [providers, setProviders] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
      setProviders([...new Set(((data.user?.identities ?? []) as Identity[]).map((i) => i.provider))]);
    });
  }, []);

  async function linkGoogle() {
    setMsg(null);
    const { error } = await createClient().auth.linkIdentity({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/settings` },
    });
    if (error) {
      setMsg({
        ok: false,
        text: "Couldn't start linking. Manual linking must be enabled in your Supabase project (see the README), and you must be signed in.",
      });
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (password.length < 8) {
      setMsg({ ok: false, text: "Use at least 8 characters." });
      return;
    }
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setMsg({ ok: false, text: error.message || "Couldn't save the password." });
    } else {
      setPassword("");
      setMsg({ ok: true, text: "Password saved. You can now sign in with your email and this password as well." });
    }
  }

  const hasGoogle = providers.includes("google");
  const hasEmail = providers.includes("email");

  return (
    <Section id="account" title="Account">
      <p>
        Signed in as <strong>{email ?? "…"}</strong>
      </p>
      <p className="text-muted">
        Sign-in methods on this account:{" "}
        {providers.length
          ? providers.map((p) => (p === "email" ? "Email & password" : p === "google" ? "Google" : p)).join(", ")
          : "…"}
        . All methods listed here open this same library.
      </p>

      <form onSubmit={savePassword} className="space-y-2">
        <label htmlFor="new-password" className="block font-medium">
          {hasEmail ? "Change password" : "Add a password (so you can also sign in with email)"}
        </label>
        <div className="flex gap-2">
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
          <Button type="submit" disabled={busy || password.length < 8}>
            Save
          </Button>
        </div>
      </form>

      {!hasGoogle && (
        <div>
          <Button onClick={linkGoogle}>Connect Google sign-in to this account</Button>
          <p className="mt-2 text-muted">
            Links Google to <em>this</em> library, so signing in with either method opens the same playlists. Only your
            Google email and name are requested.
          </p>
        </div>
      )}

      {msg &&
        (msg.ok ? (
          <p role="status" className="rounded-lg border border-ok/40 bg-ok/10 px-3 py-2">
            {msg.text}
          </p>
        ) : (
          <ErrorBox>{msg.text}</ErrorBox>
        ))}

      <div className="border-t border-line pt-4">
        <SignOutButton pendingCount={lib.pendingCount} />
      </div>
    </Section>
  );
}

function AboutSection() {
  return (
    <Section title="About playback">
      <ul className="list-disc space-y-1.5 pl-5 text-muted">
        <li>
          Music plays through YouTube&apos;s official embedded player. Its video and controls always stay visible.
        </li>
        <li>
          MyMusic does not download or store any audio or video. It saves only song details (title, channel, thumbnail
          link, length).
        </li>
        <li>
          A video may stop being available if its owner removes it or blocks playing it outside YouTube. MyMusic keeps
          the entry and tells you when it can&apos;t play.
        </li>
        <li>
          Browsers may block autoplay, and phones may pause playback when the screen locks. Background and offline
          playback are not promised.
        </li>
        <li>
          Your library is separate from your YouTube account and watch history. You never need to sign in to YouTube.
        </li>
      </ul>
    </Section>
  );
}
