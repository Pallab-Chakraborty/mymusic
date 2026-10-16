export type RemoteErrorKind =
  /** Could not reach the server, or the server had a temporary problem. Retry later. */
  | "network"
  /** The sign-in session is missing or expired. Needs the user to sign in again. */
  | "auth"
  /** The server understood and refused. Retrying the same thing will not help. */
  | "permanent";

export class RemoteError extends Error {
  constructor(
    message: string,
    public readonly kind: RemoteErrorKind,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "RemoteError";
  }
}

interface ErrorLike {
  message?: string;
  code?: string;
  status?: number;
  details?: string;
}

/** Turn whatever the Supabase client returned into a RemoteError. */
export function toRemoteError(err: unknown, status?: number): RemoteError {
  if (err instanceof RemoteError) return err;

  const e = (err ?? {}) as ErrorLike;
  const message = typeof e.message === "string" ? e.message : String(err);
  const code = typeof e.code === "string" ? e.code : undefined;
  const httpStatus = status ?? e.status;

  if (
    err instanceof TypeError ||
    httpStatus === 0 ||
    httpStatus === 408 ||
    httpStatus === 429 ||
    (typeof httpStatus === "number" && httpStatus >= 500) ||
    /failed to fetch|network|fetch failed|timeout|timed out|load failed/i.test(message)
  ) {
    return new RemoteError("Can't reach the server right now.", "network", code);
  }

  if (
    httpStatus === 401 ||
    code === "PGRST301" ||
    code === "PGRST303" ||
    /jwt|not authenticated|invalid claim/i.test(message)
  ) {
    return new RemoteError("Your session has expired. Please sign in again.", "auth", code);
  }

  return new RemoteError(friendlyMessage(code, message), "permanent", code);
}

function friendlyMessage(code: string | undefined, message: string): string {
  if (code === "P0002" || /playlist_not_found/.test(message)) {
    return "That playlist no longer exists.";
  }
  if (code === "23514") return "One of the values isn't allowed (for example a name that is empty or too long).";
  if (code === "23505") return "That item already exists.";
  if (code === "42501" || /row-level security|permission denied/i.test(message)) {
    return "You don't have permission to make that change.";
  }
  if (message === "not_in_trash") return "Only playlists in the trash can be permanently deleted.";
  return "The server could not save that change.";
}
