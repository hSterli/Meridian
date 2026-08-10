"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import { rateLimit } from "@/lib/rate-limit";
import { createJiraIssue } from "@/lib/jira/client";
import {
  createGithubIssue,
  createGithubWebhook,
  deleteGithubWebhook,
  verifyGithubRepoAccess,
} from "@/lib/github/client";
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

export interface GithubConnectionActionState extends ActionState {
  webhookWarning?: string;
}

export async function connectGithubTracker(
  _prevState: GithubConnectionActionState,
  formData: FormData
): Promise<GithubConnectionActionState> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  const repoOwner = String(formData.get("repoOwner") ?? "").trim();
  const repoName = String(formData.get("repoName") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();

  if (!projectId || !repoOwner || !repoName || !token) {
    return { error: "All fields are required." };
  }

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.activeRole !== "owner" && ctx.activeRole !== "admin") {
    return { error: "Only owners and admins can connect an issue tracker." };
  }

  const limitError = await rateLimit("connect_issue_tracker", 10, 3600);
  if (limitError) return { error: limitError };

  const access = await verifyGithubRepoAccess({ repoOwner, repoName, token });
  if ("error" in access) return { error: access.error };

  const webhookSecret = randomBytes(24).toString("base64url");
  const supabase = await createClient();

  const { data: connectionId, error } = await supabase.rpc("create_github_connection", {
    p_project_id: projectId,
    p_repo_owner: repoOwner,
    p_repo_name: repoName,
    p_token: token,
    p_webhook_secret: webhookSecret,
  });

  if (error || !connectionId) return { error: error?.message ?? "Could not save connection." };

  revalidatePath("/settings/integrations/github");

  const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/v1/webhooks/github`;
  const webhook = await createGithubWebhook({ repoOwner, repoName, token }, callbackUrl, webhookSecret);

  if ("error" in webhook) {
    return {
      webhookWarning:
        "Issue sync is connected, but automatic status updates from GitHub aren't set up yet — disconnect and reconnect to retry.",
    };
  }

  await supabase
    .from("issue_tracker_connections")
    .update({ github_webhook_id: webhook.hookId })
    .eq("id", connectionId);

  return {};
}

export async function disconnectGithubTracker(
  connectionId: string,
  repoOwner: string,
  repoName: string,
  webhookId: number | null
) {
  const supabase = await createClient();

  if (webhookId) {
    const { data: token } = await supabase.rpc("get_github_pat", { p_connection_id: connectionId });
    if (token) {
      await deleteGithubWebhook({ repoOwner, repoName, token }, webhookId);
    }
  }

  await supabase.rpc("delete_github_connection", { p_connection_id: connectionId });
  revalidatePath("/settings/integrations/github");
}

export async function sendIssueToGithub(
  projectId: string,
  issueId: string,
  connectionId: string,
  _prevState: ActionState,
  _formData: FormData
): Promise<ActionState> {
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("send_issue_to_github", 30, 3600);
  if (limitError) return { error: limitError };

  const supabase = await createClient();

  const { data: connection } = await supabase
    .from("issue_tracker_connections")
    .select("github_repo_owner, github_repo_name")
    .eq("id", connectionId)
    .single();
  if (!connection) return { error: "Connection not found." };
  if (!connection.github_repo_owner || !connection.github_repo_name) {
    return { error: "This connection is missing repo information." };
  }

  const { data: token } = await supabase.rpc("get_github_pat", { p_connection_id: connectionId });
  if (!token) return { error: "Could not retrieve GitHub credentials." };

  const { data: issue } = await supabase
    .from("issues")
    .select("title, description, severity")
    .eq("id", issueId)
    .single();
  if (!issue) return { error: "Issue not found." };

  const result = await createGithubIssue(
    { repoOwner: connection.github_repo_owner, repoName: connection.github_repo_name, token },
    issue.title,
    issue.description ?? "",
    issue.severity
  );

  if ("error" in result) return { error: result.error };

  const { error: linkError } = await supabase.from("issue_tracker_links").insert({
    issue_id: issueId,
    connection_id: connectionId,
    external_issue_key: String(result.number),
    external_issue_id: result.id,
    external_updated_at: new Date().toISOString(),
  });

  if (linkError) return { error: linkError.message };

  revalidatePath(`/projects/${projectId}/issues/${issueId}`);
  return {};
}
