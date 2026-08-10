"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import { rateLimit } from "@/lib/rate-limit";
import { transitionJiraIssueStatus } from "@/lib/jira/client";
import { setGithubIssueState } from "@/lib/github/client";
import type { IssueSeverity, IssueStatus } from "@/lib/types/database";
import type { ActionState } from "@/lib/actions/auth";

export async function createIssue(
  projectId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const severity = String(formData.get("severity") ?? "medium") as IssueSeverity;
  const linkedTestCaseId = String(formData.get("linkedTestCaseId") ?? "") || null;
  const linkedRunCaseId = String(formData.get("linkedRunCaseId") ?? "") || null;

  if (!title) return { error: "Title is required." };

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("create_issue", 60, 60);
  if (limitError) return { error: limitError };

  const supabase = await createClient();
  const { data: issue, error } = await supabase
    .from("issues")
    .insert({
      project_id: projectId,
      title,
      description: description || null,
      severity,
      linked_test_case_id: linkedTestCaseId,
      linked_run_case_id: linkedRunCaseId,
      created_by: ctx.userId,
    })
    .select()
    .single();

  if (error || !issue) return { error: error?.message ?? "Could not create issue." };

  redirect(`/projects/${projectId}/issues/${issue.id}`);
}

export async function updateIssueStatus(projectId: string, issueId: string, status: IssueStatus) {
  const supabase = await createClient();
  await supabase
    .from("issues")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", issueId);

  // If this issue is linked to an external tracker, push the status
  // change there too. Meridian's own save above already succeeded
  // regardless of what happens next — a tracker-side failure is recorded,
  // not allowed to fail the Meridian update.
  const { data: link } = await supabase
    .from("issue_tracker_links")
    .select(
      "id, external_issue_key, connection_id, issue_tracker_connections(provider, jira_base_url, jira_email, jira_project_key, github_repo_owner, github_repo_name)"
    )
    .eq("issue_id", issueId)
    .maybeSingle();

  if (link) {
    const connection = Array.isArray(link.issue_tracker_connections)
      ? link.issue_tracker_connections[0]
      : link.issue_tracker_connections;

    if (connection) {
      let result: { error?: string } | undefined;

      if (connection.provider === "jira") {
        const { data: apiToken } = await supabase.rpc("get_jira_api_token", {
          p_connection_id: link.connection_id,
        });

        if (apiToken) {
          result = await transitionJiraIssueStatus(
            {
              baseUrl: connection.jira_base_url,
              email: connection.jira_email,
              apiToken,
              projectKey: connection.jira_project_key,
            },
            link.external_issue_key,
            status
          );
        }
      } else if (connection.provider === "github") {
        const { data: token } = await supabase.rpc("get_github_pat", {
          p_connection_id: link.connection_id,
        });

        if (token && connection.github_repo_owner && connection.github_repo_name) {
          result = await setGithubIssueState(
            {
              repoOwner: connection.github_repo_owner,
              repoName: connection.github_repo_name,
              token,
            },
            Number(link.external_issue_key),
            status
          );
        }
      }

      if (result) {
        await supabase
          .from("issue_tracker_links")
          .update({
            last_sync_error: result.error ?? null,
            external_updated_at: new Date().toISOString(),
          })
          .eq("id", link.id);
      }
    }
  }

  revalidatePath(`/projects/${projectId}/issues/${issueId}`);
  revalidatePath(`/projects/${projectId}/issues`);
}

export async function deleteIssue(projectId: string, issueId: string) {
  const supabase = await createClient();
  await supabase.from("issues").delete().eq("id", issueId);
  revalidatePath(`/projects/${projectId}/issues`);
  redirect(`/projects/${projectId}/issues`);
}
