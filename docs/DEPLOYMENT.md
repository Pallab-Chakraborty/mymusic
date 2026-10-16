# Deployment (Vercel + Supabase)

## Environment variables

| Name                                   | Where the value comes from                                               | Public?                                              |
| -------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase → Project Settings → API → Project URL                          | Yes (safe)                                           |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → API Keys → Publishable key (`sb_publishable_…`)               | Yes — safe **only because** Row Level Security is on |
| `YOUTUBE_API_KEY`                      | Google Cloud → Credentials → API key (restricted to YouTube Data API v3) | **No** — server only                                 |

Never create a variable for the Supabase secret/service-role key; the app does not use it.

## Deploy checklist

1. Push the project to a **private** GitHub repository (`git remote add origin …`, `git push -u origin main`). Confirm `.env.local` is not in it.
2. https://vercel.com → **Add New → Project** → import the repo (framework: Next.js, defaults are right).
3. **Settings → Environment Variables**: add the three variables above for Production (and Preview if you want it). Redeploy.
4. Note your production address, e.g. `https://your-app.vercel.app`.
5. **Supabase → Authentication → URL Configuration**
   - **Site URL:** your production address.
   - **Redirect URLs:** add `https://your-app.vercel.app/**` and `http://localhost:3000/**`.
6. **Email templates (recommended — makes links work on any device).** Authentication → Email Templates:
   - _Confirm signup_ link: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup`
   - _Reset password_ link: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`
7. Run the smoke test below.

## Google sign-in

1. Google Cloud Console → **APIs & Services → OAuth consent screen**: set app name, support email; scopes: only the defaults (`email`, `profile`, `openid`). Publish to Production when ready (Testing mode limits to listed test users).
2. **Credentials → Create credentials → OAuth client ID → Web application.**
   - **Authorized redirect URI:** copy it from Supabase → Authentication → Sign In / Providers → Google (it looks like `https://<project-ref>.supabase.co/auth/v1/callback`).
   - Authorized JavaScript origins: your Vercel address and `http://localhost:3000`.
3. Paste the Client ID and Client Secret into **Supabase → Providers → Google** and enable it. (The secret goes only into Supabase, never into this project or Vercel.)
4. Optional manual linking: Supabase → Authentication → Sign In / Providers → turn on **Allow manual linking**.

## Account linking safety

Keep **Confirm email** ON. Supabase merges a Google login into an existing email account only when both emails are verified, so an attacker cannot pre-register someone else's address to take over their Google login.

## Production smoke test (do after every deploy)

- [ ] Open the site signed out → you land on the sign-in page.
- [ ] Create an account (confirm the email) → Home loads.
- [ ] Search a song → results with thumbnails and durations.
- [ ] Add it to a new playlist → "Added to …" appears and header shows **Saved**.
- [ ] Refresh → playlist still there.
- [ ] Open the site on your phone, sign in → same playlist.
- [ ] Play a song → video visible, play/pause/next work.
- [ ] Delete a playlist → Restore it from _Recently deleted_.
- [ ] Settings → Export all playlists → file downloads.
- [ ] Sign in with Google (same email) → same library.
- [ ] Forgot password email arrives and the link works.
