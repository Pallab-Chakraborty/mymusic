import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/env";

const PUBLIC_PATHS = ["/login", "/register", "/forgot-password", "/setup-needed"];
const PUBLIC_PREFIXES = ["/auth/"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Runs on every page request: keeps the sign-in session fresh and sends
 * signed-out visitors to the login page.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const env = getSupabaseEnv();
  const { pathname } = request.nextUrl;

  if (!env) {
    // Not configured yet: show a friendly setup page instead of crashing.
    if (pathname === "/setup-needed" || pathname.startsWith("/api/")) return NextResponse.next({ request });
    return NextResponse.redirect(new URL("/setup-needed", request.url));
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // Stops CDNs from caching a response that carries someone's session cookie.
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  // getClaims() verifies the session token's signature. (getSession() on the
  // server must not be trusted for access decisions.)
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const isApi = pathname.startsWith("/api/");
  if (!signedIn && !isPublicPath(pathname) && !isApi) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("next", pathname + request.nextUrl.search);
    return redirectWithCookies(url, response);
  }

  if (signedIn && ["/login", "/register", "/forgot-password"].includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return redirectWithCookies(url, response);
  }

  return response;
}

/** Redirect while keeping any refreshed session cookies. */
function redirectWithCookies(url: URL, from: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}
