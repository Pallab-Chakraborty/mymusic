import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safeNext";

/**
 * Where Google sign-in and email links (same-browser flow) come back to.
 * Swaps the one-time "code" for a signed-in session stored in cookies.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(next, request.url));
    } catch {
      // fall through to the error redirect
    }
  }
  return NextResponse.redirect(new URL("/login?error=callback", request.url));
}
