import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";

/**
 * Service-role client for API routes only. Unlike src/lib/supabase/server.ts
 * (cookie-based, used by every Server Component/Action for browser
 * sessions), this has no session and bypasses RLS entirely — it exists
 * solely to call validate_api_key and the api_* RPCs, which each enforce
 * their own org-scoping explicitly. Never use this to query tables
 * directly; if a table needs direct access from an API route, that's a
 * sign a new api_* function is needed, not a reason to reach for this.
 */
export function createServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
