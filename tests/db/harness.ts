import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";

/**
 * Real PostgreSQL (running inside Node via PGlite) with a tiny stand-in for
 * Supabase's `auth` schema. We apply the project's real migration files, then
 * act as different users the same way Supabase does: by switching to the
 * `authenticated` role and setting the user id that auth.uid() reads.
 */

const MIGRATIONS_DIR = path.resolve(__dirname, "../../supabase/migrations");

export async function createDb(): Promise<PGlite> {
  const db = new PGlite();

  await db.exec(`
    create schema auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text
    );
    create function auth.uid() returns uuid
      language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    create role anon nologin;
    create role authenticated nologin;
    grant usage on schema public to anon, authenticated;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  return db;
}

export async function createUser(db: PGlite, email: string): Promise<string> {
  const res = await db.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
  return res.rows[0].id;
}

/** Run `fn` as a signed-in user (RLS applies, exactly like the real app). */
export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

/** Run `fn` as a signed-out visitor. */
export async function asAnon<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec("set role anon");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

export function vid(n: number): string {
  // valid 11-character YouTube-style id
  return `vid${String(n).padStart(8, "0")}`;
}

export const track = (n: number) => ({
  video_id: vid(n),
  title: `Song ${n}`,
  channel_title: `Channel ${n}`,
  thumbnail_url: `https://i.ytimg.com/vi/${vid(n)}/hqdefault.jpg`,
  duration_seconds: 180 + n,
});
