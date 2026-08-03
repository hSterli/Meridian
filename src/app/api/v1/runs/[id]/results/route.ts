import { authenticateApiRequest } from "@/lib/api/auth";
import { rateLimitApiKey } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";

const VALID_STATUSES = ["pending", "passed", "failed", "blocked", "skipped"] as const;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiRequest(request);
  if (auth instanceof Response) return auth;

  const limitError = await rateLimitApiKey(auth.keyId, "api_create_run_result", 300, 300);
  if (limitError) return Response.json({ error: limitError }, { status: 429 });

  const { id: runId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { testCaseId, status, notes } = (body ?? {}) as {
    testCaseId?: string;
    status?: string;
    notes?: string;
  };

  if (!testCaseId) {
    return Response.json({ error: "testCaseId is required." }, { status: 400 });
  }
  if (!status || !(VALID_STATUSES as readonly string[]).includes(status)) {
    return Response.json(
      { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("api_create_run_result", {
    p_org_id: auth.orgId,
    p_run_id: runId,
    p_test_case_id: testCaseId,
    p_status: status as (typeof VALID_STATUSES)[number],
    p_notes: notes ?? undefined,
  });

  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ data: data?.[0] }, { status: 201 });
}
