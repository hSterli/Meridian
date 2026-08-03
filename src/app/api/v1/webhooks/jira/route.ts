import { createServiceClient } from "@/lib/supabase/service";
import type { IssueStatus } from "@/lib/types/database";

// Jira's own workflow status names vary per project, so incoming webhook
// status names are matched case-insensitively against this fixed set of
// common defaults. A name that doesn't match anything here is simply not
// applied — better than guessing wrong.
const STATUS_FROM_JIRA: Record<string, IssueStatus> = {
  "to do": "open",
  open: "open",
  backlog: "open",
  "in progress": "in_progress",
  "in review": "in_progress",
  done: "resolved",
  resolved: "resolved",
  closed: "closed",
};

interface JiraWebhookPayload {
  issue?: {
    id: string;
    key: string;
    fields?: {
      status?: { name: string };
      updated?: string;
    };
  };
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const rawBody = await request.text();

  const supabase = createServiceClient();

  const { data: connection } = token
    ? await supabase
        .from("issue_tracker_connections")
        .select("id, org_id")
        .eq("webhook_token", token)
        .maybeSingle()
    : { data: null };

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  // Stored regardless of validity, same audit-trail principle as the
  // generic webhook scaffold — an invalid token still leaves a record.
  await supabase.from("webhook_events").insert({
    source: "jira",
    org_id: connection?.org_id ?? null,
    payload: payload as never,
    signature_valid: Boolean(connection),
  });

  if (!connection) {
    return Response.json({ error: "Invalid webhook token." }, { status: 401 });
  }

  const jiraPayload = payload as JiraWebhookPayload;
  const externalIssueId = jiraPayload.issue?.id;
  if (!externalIssueId) {
    return Response.json({ status: "ignored" });
  }

  const { data: link } = await supabase
    .from("issue_tracker_links")
    .select("id, issue_id, external_updated_at")
    .eq("external_issue_id", externalIssueId)
    .eq("connection_id", connection.id)
    .maybeSingle();

  if (!link) {
    return Response.json({ status: "ignored" });
  }

  const jiraUpdatedAt = jiraPayload.issue?.fields?.updated
    ? new Date(jiraPayload.issue.fields.updated)
    : null;
  const lastSyncedAt = link.external_updated_at ? new Date(link.external_updated_at) : null;

  // Last-write-wins: if Jira's own reported update time is not newer than
  // what we last synced, this is a stale/duplicate delivery — ignore it.
  if (jiraUpdatedAt && lastSyncedAt && jiraUpdatedAt.getTime() <= lastSyncedAt.getTime()) {
    return Response.json({ status: "stale, ignored" });
  }

  const jiraStatusName = jiraPayload.issue?.fields?.status?.name?.toLowerCase();
  const mappedStatus = jiraStatusName ? STATUS_FROM_JIRA[jiraStatusName] : undefined;

  if (mappedStatus) {
    await supabase
      .from("issues")
      .update({ status: mappedStatus, updated_at: new Date().toISOString() })
      .eq("id", link.issue_id);
  }

  await supabase
    .from("issue_tracker_links")
    .update({
      external_updated_at: jiraUpdatedAt?.toISOString() ?? new Date().toISOString(),
    })
    .eq("id", link.id);

  return Response.json({ status: "received" });
}
