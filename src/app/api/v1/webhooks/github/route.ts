import { createServiceClient } from "@/lib/supabase/service";
import { verifyGithubSignature } from "@/lib/github/client";
import type { IssueStatus } from "@/lib/types/database";

const STATUS_FROM_GITHUB_ACTION: Record<string, IssueStatus> = {
  closed: "resolved",
  reopened: "open",
};

interface GithubIssuesWebhookPayload {
  action?: string;
  issue?: { id: number; number: number };
  repository?: { name: string; owner: { login: string } };
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const githubPayload = payload as GithubIssuesWebhookPayload;
  const repoOwner = githubPayload.repository?.owner?.login;
  const repoName = githubPayload.repository?.name;

  const supabase = createServiceClient();

  const { data: connection } =
    repoOwner && repoName
      ? await supabase
          .from("issue_tracker_connections")
          .select("id, org_id, github_webhook_secret")
          .eq("provider", "github")
          .eq("github_repo_owner", repoOwner)
          .eq("github_repo_name", repoName)
          .maybeSingle()
      : { data: null };

  const signatureValid = Boolean(
    connection?.github_webhook_secret &&
      verifyGithubSignature(rawBody, signature, connection.github_webhook_secret)
  );

  // Stored regardless of validity, same audit-trail principle as the
  // generic webhook scaffold and the Jira webhook route.
  await supabase.from("webhook_events").insert({
    source: "github",
    org_id: connection?.org_id ?? null,
    payload: payload as never,
    signature_valid: signatureValid,
  });

  if (!connection || !signatureValid) {
    return Response.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  const externalIssueId = githubPayload.issue?.id;
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

  const mappedStatus = githubPayload.action
    ? STATUS_FROM_GITHUB_ACTION[githubPayload.action]
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
