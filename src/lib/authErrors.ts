/** Turn Supabase Auth errors into plain words. Never shows raw server text for unknown errors. */
export function friendlyAuthError(
  err: { message?: string; code?: string; status?: number } | null | undefined,
): string {
  if (!err) return "Something went wrong. Please try again.";
  const code = err.code ?? "";
  const msg = (err.message ?? "").toLowerCase();

  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) {
    return "That email and password don't match. Check them and try again, or reset your password.";
  }
  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) {
    return "Please confirm your email first. Open the link we sent you, then sign in.";
  }
  if (code === "weak_password" || msg.includes("password should") || msg.includes("weak password")) {
    return "That password is too weak. Use at least 8 characters that aren't easy to guess.";
  }
  if (
    code === "over_request_rate_limit" ||
    code === "over_email_send_rate_limit" ||
    err.status === 429 ||
    msg.includes("rate limit")
  ) {
    return "Too many attempts. Please wait a few minutes and try again.";
  }
  if (code === "user_already_exists" || msg.includes("already registered")) {
    return "An account with that email may already exist. Try signing in, or reset your password.";
  }
  if (code === "same_password" || msg.includes("different from the old password")) {
    return "Choose a password that is different from your current one.";
  }
  if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("fetch failed")) {
    return "Couldn't reach the server. Check your internet connection and try again.";
  }
  return "Something went wrong. Please try again.";
}

export const MIN_PASSWORD_LENGTH = 8;
