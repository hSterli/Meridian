import { authenticateApiRequest } from "@/lib/api/auth";
import { rateLimitApiKey } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/lib/types/database";
import { validateIngestRequestBody, type IngestResultInput } from "@/lib/validation/ingest-request";
import { postOrUpdatePrComment } from "@/lib/github/client";
import { postSlackMessage, formatRunNotification } from "@/lib/slack/client";

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

  const validation = validateIngestRequestBody(body);
  if ("error" in validation) {
    return Response.json({ error: validation.error }, { status: 400 });
  }
  const { projectId, runName, results, prNumber } = validation.data;

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("api_ingest_run_results", {
    p_org_id: auth.orgId,
    p_key_id: auth.keyId,
    p_project_id: projectId,
    p_run_name: runName,
    p_results: results as unknown as Json,
    p_pr_number: prNumber,
  });

  if (error) return Response.json({ error: error.message }, { status: 400 });
  const row = data?.[0];

  let prCommentPosted = false;
  if (row?.pr_url && prNumber && row.run_id) {
    prCommentPosted = await tryPostPrComment({
      orgId: auth.orgId,
      projectId,
      prNumber,
      runId: row.run_id,
      runName,
      results,
    });
  }

  let slackNotified = false;
  if (row?.run_id) {
    slackNotified = await trySendSlackNotification({
      orgId: auth.orgId,
      projectId,
      runId: row.run_id,
      runName,
      results,
    });
  }

  return Response.json(
    {
      data: {
        runId: row?.run_id,
        matched: row?.matched,
        autoCreated: row?.auto_created,
        prCommentPosted,
        slackNotified,
      },
    },
    { status: 201 }
  );
}

// Shared by both best-effort notification paths below so the counts aren't
// computed twice per request.
function countResultsByStatus(results: IngestResultInput[]) {
  const counts = { passed: 0, failed: 0, blocked: 0, skipped: 0 };
  for (const r of results) {
    if (r.status && r.status in counts) {
      counts[r.status as keyof typeof counts] += 1;
    }
  }
  return counts;
}

// Best-effort: any failure here (bad/revoked PAT, renamed repo, GitHub
// outage) is caught and never fails the ingest response — the run was
// already recorded successfully by the time this runs.
async function tryPostPrComment(args: {
  orgId: string;
  projectId: string;
  prNumber: number;
  runId: string;
  runName: string;
  results: IngestResultInput[];
}): Promise<boolean> {
  try {
    const supabase = createServiceClient();
    const { data } = await supabase.rpc("api_get_github_pat_for_project", {
      p_org_id: args.orgId,
      p_project_id: args.projectId,
    });
    const row = data?.[0];
    if (!row?.token || !row.repo_owner || !row.repo_name) return false;

    const counts = countResultsByStatus(args.results);
    const runUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/projects/${args.projectId}/runs/${args.runId}`;

    const result = await postOrUpdatePrComment(
      { repoOwner: row.repo_owner, repoName: row.repo_name, token: row.token },
      args.prNumber,
      {
        projectId: args.projectId,
        runName: args.runName,
        runUrl,
        passed: counts.passed,
        failed: counts.failed,
        blocked: counts.blocked,
        skipped: counts.skipped,
      }
    );

    return "ok" in result;
  } catch {
    return false;
  }
}

// Best-effort, same pattern as tryPostPrComment: any failure (no
// connection, revoked bot token, channel access revoked, Slack outage) is
// caught and never fails the ingest response — the run was already
// recorded successfully by the time this runs. Unlike tryPostPrComment,
// this runs unconditionally after every successful ingest (not gated on a
// prNumber) — Slack notification is scoped to "a CI run completed", not to
// "a run associated with a PR".
async function trySendSlackNotification(args: {
  orgId: string;
  projectId: string;
  runId: string;
  runName: string;
  results: IngestResultInput[];
}): Promise<boolean> {
  try {
    const supabase = createServiceClient();
    const { data } = await supabase.rpc("api_get_slack_bot_token_for_project", {
      p_org_id: args.orgId,
      p_project_id: args.projectId,
    });
    const row = data?.[0];
    if (!row?.token || !row.channel_id) return false;

    const counts = countResultsByStatus(args.results);
    const runUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/projects/${args.projectId}/runs/${args.runId}`;

    const result = await postSlackMessage(
      { botToken: row.token, channelId: row.channel_id },
      formatRunNotification({
        runName: args.runName,
        runUrl,
        passed: counts.passed,
        failed: counts.failed,
        blocked: counts.blocked,
        skipped: counts.skipped,
      })
    );

    return "ok" in result;
  } catch {
    return false;
  }
}
