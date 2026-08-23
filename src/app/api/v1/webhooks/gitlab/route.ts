import { createServiceClient } from "@/lib/supabase/service";
import { verifyGitlabWebhookToken } from "@/lib/gitlab/client";
import type { IssueStatus } from "@/lib/types/database";

const STATUS_FROM_GITLAB_ACTION: Record<string, IssueStatus> = {
  close: "resolved",
  reopen: "open",
};

interface GitlabIssueWebhookPayload {
  object_kind?: string;
  object_attributes?: { action?: string; iid?: number; id?: number };
  project?: { path_with_namespace?: string };
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const tokenHeader = request.headers.get("x-gitlab-token");

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const gitlabPayload = payload as GitlabIssueWebhookPayload;
  const projectPath = gitlabPayload.project?.path_with_namespace;

  const supabase = createServiceClient();

  const { data: connection } = projectPath
    ? await supabase
        .from("issue_tracker_connections")
        .select("id, org_id, gitlab_webhook_token")
        .eq("provider", "gitlab")
        .eq("gitlab_project_path", projectPath)
        .maybeSingle()
    : { data: null };

  const tokenValid = Boolean(
    connection?.gitlab_webhook_token &&
      verifyGitlabWebhookToken(tokenHeader, connection.gitlab_webhook_token)
  );

  // Stored regardless of validity, same audit-trail principle as the
  // Jira/GitHub webhook routes.
  await supabase.from("webhook_events").insert({
    source: "gitlab",
    org_id: connection?.org_id ?? null,
    payload: payload as never,
    signature_valid: tokenValid,
  });

  if (!connection || !tokenValid) {
    return Response.json({ error: "Invalid webhook token." }, { status: 401 });
  }

  if (gitlabPayload.object_kind !== "issue") {
    return Response.json({ status: "ignored" });
  }

  const externalIssueId = gitlabPayload.object_attributes?.id;
  if (!externalIssueId) {
    return Response.json({ status: "ignored" });
  }

  const { data: link } = await supabase
    .from("issue_tracker_links")
    .select("id, issue_id")
    .eq("external_issue_id", String(externalIssueId))
    .eq("connection_id", connection.id)
    .maybeSingle();

  if (!link) {
    return Response.json({ status: "ignored" });
  }

  const mappedStatus = gitlabPayload.object_attributes?.action
    ? STATUS_FROM_GITLAB_ACTION[gitlabPayload.object_attributes.action]
    : undefined;

  if (mappedStatus) {
    await supabase
      .from("issues")
      .update({ status: mappedStatus, updated_at: new Date().toISOString() })
      .eq("id", link.issue_id);
  }

  await supabase
    .from("issue_tracker_links")
    .update({ external_updated_at: new Date().toISOString() })
    .eq("id", link.id);

  return Response.json({ status: "received" });
}
