# Project status

## Verified (by automated checks run in this build environment)

- [x] Lint, type check, formatting, production build pass.
- [x] 178 unit tests + database tests against the **real migration** on PostgreSQL (PGlite), including RLS isolation between users.
- [x] 30 browser end-to-end tests against a **fake** Supabase/YouTube: sign-in/out, protected routes, redirect safety, primary journey (register → search → add → create playlist → refresh → second device sees same library), user isolation, offline queue + retry, outage recovery, rename/reorder/remove/duplicate, no duplicates, trash/restore/permanent delete, export JSON/M3U + import, search error states, player size rule (≥200×200), autoplay-blocked and blocked-embed messages.

## NOT verified (needs your real accounts)

- [ ] Real Supabase project: migration applied, real email confirmation/reset emails, real RLS in the hosted database.
- [ ] Google sign-in and account linking.
- [ ] Real YouTube search (API key, quota) and the real YouTube embedded player (tests use a stand-in).
- [ ] Vercel deployment and live smoke test (no URL exists yet).

## Known limitations

- Reopening the site while fully offline needs a service worker (not included). An already-open page keeps working and queues changes.
- Search rate limiter is per server instance.

## Actions needed from you

1. Create Supabase project, run the migration (README Step 3).
2. Create the YouTube API key (Step 4).
3. Fill `.env.local`, run `npm run dev`, try it.
4. Push to a private GitHub repo, import into Vercel, add env vars, set Supabase URLs (docs/DEPLOYMENT.md).
5. Optional: Google OAuth setup.
