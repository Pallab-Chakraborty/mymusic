# MyMusic

A personal music library built on YouTube. Search with the YouTube Data API, save songs into permanent playlists, and
play them from any device.

**Live demo: https://mymusic-two-delta.vercel.app** (create a free account to try it)

> Playback uses YouTube's official embedded player, and its video and controls always stay visible. MyMusic never
> downloads or stores audio or video. It stores only song details (title, channel, thumbnail link, length).

## Features

- **Search:** YouTube Data API v3, embeddable videos only. The API key stays on the server.
- **Playlists:** create, rename, duplicate, reorder by drag and drop, soft-delete to a recoverable trash, find a song
  inside a playlist, and sort by title, artist or length.
- **Player:** persistent mini-player and full-screen player with queue, shuffle, repeat, seek, volume and keyboard
  shortcuts (Space, ← →, N, P, M).
- **Accounts:** email/password and Google sign-in through Supabase Auth. Each user has a private library.
- **Reliable saving:** changes are saved to Postgres automatically, with Saved / Saving / Offline / Error status.
  Changes made offline are queued in IndexedDB and retried with backoff.
- **Data portability:** JSON export and import, M3U export, recently played history, settings.

## Tech stack

Next.js (App Router) · React · TypeScript · Tailwind CSS · Supabase (Postgres, Auth, Row Level Security, SQL
functions) · YouTube Data API v3 and IFrame Player API · Vercel · Vitest · Playwright.

## How it works

- **Database:** tables `profiles`, `user_settings`, `playlists`, `playlist_tracks`, `recently_played`. Row Level
  Security is enabled on every table, and writes go through SQL functions. See
  `supabase/migrations/20261015000000_init.sql`.
- **Client state:** a local store applies each change immediately, queues it, and sends it to Supabase. A change is
  reported as saved only after the database confirms it (`src/lib/library`).
- **Server:** route handlers proxy YouTube search so the API key never reaches the browser, with request validation,
  CSRF checks and rate limiting (`src/app/api`).
- **Auth:** `@supabase/ssr` with server-side session checks in a proxy and in the app layout.

## Getting started

Requirements: Node.js 22 or newer, a free [Supabase](https://supabase.com) project, and a YouTube Data API key.

```bash
git clone https://github.com/Pallab-Chakraborty/mymusic.git
cd mymusic
npm install
cp .env.example .env.local
```

1. **Database:** in the Supabase SQL Editor, run `supabase/migrations/20261015000000_init.sql`.
2. **Auth:** in Supabase, keep Email sign-in enabled with email confirmation on, and add
   `http://localhost:3000/**` to the redirect URLs.
3. **YouTube key:** in Google Cloud, enable YouTube Data API v3, create an API key, and restrict it to that API.
4. **Environment:** fill in `.env.local` (see below), then run `npm run dev` and open http://localhost:3000.

### Environment variables

| Variable                               | Where it is used | Notes                                                                 |
| -------------------------------------- | ---------------- | --------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Browser + server | Supabase project URL                                                  |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser + server | Publishable key (`sb_publishable_…`). Never use the service-role key. |
| `YOUTUBE_API_KEY`                      | Server only      | Never prefix it with `NEXT_PUBLIC_`                                   |

`.env.local` is ignored by Git. Never commit real keys.

## Scripts

| Command            | What it does                                                                      |
| ------------------ | --------------------------------------------------------------------------------- |
| `npm run dev`      | Run locally                                                                       |
| `npm run check`    | Format check, lint, type check, unit tests and production build                   |
| `npm test`         | Unit and database tests (RLS tested on a real Postgres engine, PGlite)            |
| `npm run test:e2e` | Browser tests against a fake backend (run `npx playwright install chromium` once) |

## Deployment

Deployed on Vercel with the three environment variables above. In Supabase, set the Site URL and add the deployed
address to the redirect URLs. Details, including Google sign-in, are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Limitations

- Videos can disappear or block embedding, and phones may pause playback when the screen locks.
- Search is limited by the YouTube API daily quota (about 100 searches a day on the default quota). The live demo
  shares one key, so search may pause until the quota resets.
- The demo runs on free tiers. A Supabase free project can pause after about a week without activity, and the first
  request after that may be slow or fail until it wakes up.
- A fresh page load while offline needs a service worker, which is not included.
- Free Supabase projects do not promise independent backups. Use Settings → Export for your own copy.

## More

[Deployment](docs/DEPLOYMENT.md) · [Backup and restore](docs/BACKUP_AND_RESTORE.md) ·
[Security notes](docs/SECURITY.md)





