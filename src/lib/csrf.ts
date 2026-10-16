/**
 * For requests that change data: browsers always send an Origin header on
 * cross-site POSTs, so reject any request whose Origin is a different site.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin navigations and non-browser clients
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
