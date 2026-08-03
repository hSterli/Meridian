import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

export interface ApiAuthContext {
  keyId: string;
  orgId: string;
}

/**
 * Extracts and validates the Authorization: Bearer <key> header on an
 * incoming API request. Returns the resolved (keyId, orgId) on success, or
 * a ready-to-return 401 Response on failure — callers should check
 * `instanceof Response` and return it directly rather than inspecting it.
 */
export async function authenticateApiRequest(
  request: Request
): Promise<ApiAuthContext | Response> {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return Response.json(
      { error: "Missing or invalid Authorization header." },
      { status: 401 }
    );
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("validate_api_key", { p_key: match[1] });

  if (error || !data || data.length === 0) {
    return Response.json({ error: "Invalid or revoked API key." }, { status: 401 });
  }

  return { keyId: data[0].key_id, orgId: data[0].org_id };
}
