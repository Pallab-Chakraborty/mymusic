# Security notes

- Row Level Security is enabled on every user-owned table; policies restrict every row to `auth.uid()`. Tested against the real migration in `tests/db`.
- Only the publishable key reaches the browser. No service-role key is used anywhere. `YOUTUBE_API_KEY` is server-only and never logged.
- Sessions are verified server-side with `getClaims()`; pages and API routes require sign-in.
- Import: size-limited, schema-validated, same-origin only, rate-limited, saved via all-or-nothing database functions that run as the user.
- Search: sign-in required, input validated, rate limited and cached. The rate limiter is per server instance (best effort); use Upstash Redis for a strict global limit.
- Redirect targets (`?next=`) are restricted to same-site paths; thumbnails only load from YouTube's image hosts.
- Security headers are set in `next.config.ts`. Local library cache is removed on sign-out.
