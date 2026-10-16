/**
 * Public (browser-safe) settings. These two values are designed to be public:
 * the Supabase "publishable" key is only safe because Row Level Security in the
 * database restricts every user to their own rows.
 *
 * NEXT_PUBLIC_* variables must be written out in full like this so Next.js can
 * place their values into the browser bundle.
 */
export function getSupabaseEnv(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

export function requireSupabaseEnv(): { url: string; key: string } {
  const env = getSupabaseEnv();
  if (!env) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (see README).",
    );
  }
  return env;
}
