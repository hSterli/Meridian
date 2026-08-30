import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ProjectTabs } from "@/components/layout/project-tabs";
import { updateIssueStatus, deleteIssue } from "@/lib/actions/issues";
import { sendIssueToJira, sendIssueToGithub } from "@/lib/actions/issue-tracker";
import { SendToJiraForm } from "@/components/issues/send-to-jira-form";
import { SendToGithubForm } from "@/components/issues/send-to-github-form";
import type { IssueStatus } from "@/lib/types/database";

const STATUSES: IssueStatus[] = ["open", "in_progress", "resolved", "closed"];

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; issueId: string }>;
}) {
  const { projectId, issueId } = await params;
  const supabase = await createClient();

  const { data: issue } = await supabase
    .from("issues")
    .select("*, test_cases(id, title)")
    .eq("id", issueId)
    .single();

  if (!issue) notFound();

  const { data: project } = await supabase
    .from("projects")
    .select("org_id, name")
    .eq("id", projectId)
    .single();

  const { data: jiraConnection } = project
    ? await supabase
        .from("issue_tracker_connections")
        .select("id, jira_base_url")
        .eq("org_id", project.org_id)
        .eq("provider", "jira")
        .maybeSingle()
    : { data: null };

  const { data: githubConnection } = await supabase
    .from("issue_tracker_connections")
    .select("id, github_repo_owner, github_repo_name")
    .eq("project_id", projectId)
    .eq("provider", "github")
    .maybeSingle();

  const { data: link } = await supabase
    .from("issue_tracker_links")
    .select(
      "external_issue_key, last_sync_error, issue_tracker_connections(provider, jira_base_url, github_repo_owner, github_repo_name)"
    )
    .eq("issue_id", issueId)
    .maybeSingle();

  const linkedConnection = link
    ? Array.isArray(link.issue_tracker_connections)
      ? link.issue_tracker_connections[0]
      : link.issue_tracker_connections
    : null;

  const deleteAction = deleteIssue.bind(null, projectId, issueId);
  const sendToJiraAction = jiraConnection
    ? sendIssueToJira.bind(null, projectId, issueId, jiraConnection.id)
    : null;
  const sendToGithubAction = githubConnection
    ? sendIssueToGithub.bind(null, projectId, issueId, githubConnection.id)
    : null;

  return (
    <div className="max-w-2xl">
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project?.name ?? "Project", href: `/projects/${projectId}/test-cases` },
          { label: "Issues", href: `/projects/${projectId}/issues` },
          { label: issue.title },
        ]}
      />
      <PageHeader
        title={issue.title}
        action={<Badge tone="indigo">{issue.severity}</Badge>}
      />
      <ProjectTabs projectId={projectId} />

      <Card className="mt-6 p-6">
        {issue.description && (
          <p className="mb-4 whitespace-pre-wrap text-sm text-ink-secondary">{issue.description}</p>
        )}

        {issue.test_cases && (
          <p className="mb-4 text-sm text-ink-tertiary">
            Linked test case:{" "}
            <Link
              href={`/projects/${projectId}/test-cases/${issue.test_cases.id}`}
              className="font-medium text-primary"
            >
              {issue.test_cases.title}
            </Link>
          </p>
        )}

        {link && linkedConnection ? (
          <p className="mb-4 text-sm text-ink-tertiary">
            Synced to {linkedConnection.provider === "github" ? "GitHub" : "Jira"}:{" "}
            <a
              href={
                linkedConnection.provider === "github"
                  ? `https://github.com/${linkedConnection.github_repo_owner}/${linkedConnection.github_repo_name}/issues/${link.external_issue_key}`
                  : `${linkedConnection.jira_base_url}/browse/${link.external_issue_key}`
              }
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary"
            >
              {link.external_issue_key}
            </a>
            {link.last_sync_error && (
              <span className="ml-2 text-fail">Last sync failed: {link.last_sync_error}</span>
            )}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sendToJiraAction && <SendToJiraForm action={sendToJiraAction} />}
            {sendToGithubAction && <SendToGithubForm action={sendToGithubAction} />}
          </div>
        )}

        <div className="mb-2 text-sm font-medium text-ink-secondary">Status</div>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((status) => {
            const action = updateIssueStatus.bind(null, projectId, issueId, status);
            const isCurrent = issue.status === status;
            return (
              <form key={status} action={action}>
                <Button type="submit" variant={isCurrent ? "primary" : "secondary"} disabled={isCurrent}>
                  {status.replace("_", " ")}
                </Button>
              </form>
            );
          })}
        </div>
      </Card>

      <form action={deleteAction} className="mt-4">
        <Button type="submit" variant="danger">
          Delete issue
        </Button>
      </form>
    </div>
  );
}
