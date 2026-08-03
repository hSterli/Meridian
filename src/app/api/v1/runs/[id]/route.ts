import { authenticateApiRequest } from "@/lib/api/auth";
import { rateLimitApiKey } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiRequest(request);
  if (auth instanceof Response) return auth;

  const limitError = await rateLimitApiKey(auth.keyId, "api_get_run", 300, 60);
  if (limitError) return Response.json({ error: limitError }, { status: 429 });

  const { id } = await context.params;
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("api_get_run", {
    p_org_id: auth.orgId,
    p_run_id: id,
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data || data.length === 0) {
    return Response.json({ error: "Run not found." }, { status: 404 });
  }
  return Response.json({ data: data[0] });
}
