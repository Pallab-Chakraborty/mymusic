/**
 * Only allow redirects to a path on this same site.
 * Blocks open-redirect tricks such as "//evil.com", "/\evil.com" or "https://evil.com".
 */
export function safeNextPath(value: string | null | undefined, fallback = "/"): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f]/.test(value)) return fallback;
  return value;
}
