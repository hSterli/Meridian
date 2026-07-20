import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Checks a per-user rate-limit bucket via the `check_rate_limit` Postgres
 * function (see supabase/migrations/0007_rate_limiting.sql). The bucket key
 * is derived server-side from the caller's own auth.uid(), so this can only
 * ever throttle the calling user's own actions — never anyone else's.
 *
 * Returns an error string to surface in an ActionState on failure, or null
 * if the caller is within their limit.
 */
export async function rateLimit(
  action: string,
  limit: number,
  windowSeconds: number
): Promise<string | null> {
  const supabase = await createClient();
  const { data: allowed, error } = await supabase.rpc("check_rate_limit", {
    p_action: action,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    // Fail closed on auth errors (not signed in), open on unexpected DB
    // hiccups so a transient issue with the rate-limit table itself doesn't
    // take down the whole app.
    return error.message.includes("Not authenticated") ? "Not authenticated." : null;
  }

  if (!allowed) {
    return "You're doing that too often — please wait a bit and try again.";
  }

  return null;
}
