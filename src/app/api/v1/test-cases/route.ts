import { authenticateApiRequest } from "@/lib/api/auth";
import { rateLimitApiKey } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (auth instanceof Response) return auth;

  const limitError = await rateLimitApiKey(auth.keyId, "api_list_test_cases", 300, 60);
  if (limitError) return Response.json({ error: limitError }, { status: 429 });

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return Response.json({ error: "projectId query param is required." }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("api_list_test_cases", {
    p_org_id: auth.orgId,
    p_project_id: projectId,
  });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ data });
}
