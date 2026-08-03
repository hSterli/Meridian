"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import { rateLimit } from "@/lib/rate-limit";
import { createJiraIssue } from "@/lib/jira/client";
import type { ActionState } from "@/lib/actions/auth";

export interface JiraConnectionActionState extends ActionState {
  webhookUrl?: string;
}

export async function connectJiraTracker(
  orgId: string,
  _prevState: JiraConnectionActionState,
  formData: FormData
): Promise<JiraConnectionActionState> {
  const baseUrl = String(formData.get("baseUrl") ?? "").trim().replace(/\/$/, "");
  const email = String(formData.get("email") ?? "").trim();
  const apiToken = String(formData.get("apiToken") ?? "").trim();
  const projectKey = String(formData.get("projectKey") ?? "").trim();

  if (!baseUrl || !email || !apiToken || !projectKey) {
    return { error: "All fields are required." };
  }

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.activeRole !== "owner" && ctx.activeRole !== "admin") {
    return { error: "Only owners and admins can connect an issue tracker." };
  }

  const limitError = await rateLimit("connect_issue_tracker", 10, 3600);
  if (limitError) return { error: limitError };

  const webhookToken = randomBytes(24).toString("base64url");
  const supabase = await createClient();

  const { data: connectionId, error } = await supabase.rpc("create_jira_connection", {
    p_org_id: orgId,
    p_base_url: baseUrl,
    p_email: email,
    p_token: apiToken,
    p_webhook_token: webhookToken,
    p_project_key: projectKey,
  });

  if (error || !connectionId) return { error: error?.message ?? "Could not save connection." };

  revalidatePath("/settings/integrations/jira");
  return {
    webhookUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/v1/webhooks/jira?token=${webhookToken}`,
  };
}

export async function disconnectJiraTracker(connectionId: string) {
  const supabase = await createClient();
  await supabase.rpc("delete_jira_connection", { p_connection_id: connectionId });
  revalidatePath("/settings/integrations/jira");
}

export async function sendIssueToJira(
  projectId: string,
  issueId: string,
  connectionId: string,
  _prevState: ActionState,
  _formData: FormData
): Promise<ActionState> {
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("send_issue_to_jira", 30, 3600);
  if (limitError) return { error: limitError };

  const supabase = await createClient();

  const { data: connection } = await supabase
    .from("issue_tracker_connections")
    .select("jira_base_url, jira_email, jira_project_key")
    .eq("id", connectionId)
    .single();
  if (!connection) return { error: "Connection not found." };

  const { data: apiToken } = await supabase.rpc("get_jira_api_token", {
    p_connection_id: connectionId,
  });
  if (!apiToken) return { error: "Could not retrieve Jira credentials." };

  const { data: issue } = await supabase
    .from("issues")
    .select("title, description, severity")
    .eq("id", issueId)
    .single();
  if (!issue) return { error: "Issue not found." };

  const result = await createJiraIssue(
    {
      baseUrl: connection.jira_base_url,
      email: connection.jira_email,
      apiToken,
      projectKey: connection.jira_project_key,
    },
    issue.title,
    issue.description ?? "",
    issue.severity
  );

  if ("error" in result) return { error: result.error };

  const { error: linkError } = await supabase.from("issue_tracker_links").insert({
    issue_id: issueId,
    connection_id: connectionId,
    external_issue_key: result.key,
    external_issue_id: result.id,
    external_updated_at: new Date().toISOString(),
  });

  if (linkError) return { error: linkError.message };

  revalidatePath(`/projects/${projectId}/issues/${issueId}`);
  return {};
}
