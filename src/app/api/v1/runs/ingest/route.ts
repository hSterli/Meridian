import { authenticateApiRequest } from "@/lib/api/auth";
import { rateLimitApiKey } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/lib/types/database";

const VALID_STATUSES = ["passed", "failed", "blocked", "skipped"] as const;

interface IngestResult {
  title?: string;
  status?: string;
  notes?: string;
}

export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if (auth instanceof Response) return auth;

  const limitError = await rateLimitApiKey(auth.keyId, "api_ingest_run_results", 20, 3600);
  if (limitError) return Response.json({ error: limitError }, { status: 429 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { projectId, runName, results } = (body ?? {}) as {
    projectId?: string;
    runName?: string;
    results?: IngestResult[];
  };

  if (!projectId) {
    return Response.json({ error: "projectId is required." }, { status: 400 });
  }
  if (!runName) {
    return Response.json({ error: "runName is required." }, { status: 400 });
  }
  if (!Array.isArray(results) || results.length === 0) {
    return Response.json({ error: "results must be a non-empty array." }, { status: 400 });
  }

  for (const r of results) {
    if (!r.title) {
      return Response.json({ error: "Each result requires a title." }, { status: 400 });
    }
    if (!r.status || !(VALID_STATUSES as readonly string[]).includes(r.status)) {
      return Response.json(
        { error: `Each result's status must be one of: ${VALID_STATUSES.join(", ")}` },
        { status: 400 }
      );
    }
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("api_ingest_run_results", {
    p_org_id: auth.orgId,
    p_key_id: auth.keyId,
    p_project_id: projectId,
    p_run_name: runName,
    p_results: results as unknown as Json,
  });

  if (error) return Response.json({ error: error.message }, { status: 400 });
  const row = data?.[0];
  return Response.json(
    { data: { runId: row?.run_id, matched: row?.matched, autoCreated: row?.auto_created } },
    { status: 201 }
  );
}
