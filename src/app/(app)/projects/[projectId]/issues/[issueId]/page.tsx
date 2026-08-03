import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { updateIssueStatus, deleteIssue } from "@/lib/actions/issues";
import { sendIssueToJira } from "@/lib/actions/issue-tracker";
import { SendToJiraForm } from "@/components/issues/send-to-jira-form";
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
    .select("org_id")
    .eq("id", projectId)
    .single();

  const { data: connection } = project
    ? await supabase
        .from("issue_tracker_connections")
        .select("id, jira_base_url")
        .eq("org_id", project.org_id)
        .eq("provider", "jira")
        .maybeSingle()
    : { data: null };

  const { data: link } = await supabase
    .from("issue_tracker_links")
    .select("external_issue_key, last_sync_error")
    .eq("issue_id", issueId)
    .maybeSingle();

  const deleteAction = deleteIssue.bind(null, projectId, issueId);
  const sendToJiraAction = connection
    ? sendIssueToJira.bind(null, projectId, issueId, connection.id)
    : null;

  return (
    <div className="max-w-2xl">
      <PageHeader
        title={issue.title}
        action={<Badge tone="indigo">{issue.severity}</Badge>}
      />

      <Card className="p-6">
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

        {link ? (
          <p className="mb-4 text-sm text-ink-tertiary">
            Synced to Jira:{" "}
            <a
              href={`${connection?.jira_base_url}/browse/${link.external_issue_key}`}
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
          sendToJiraAction && <SendToJiraForm action={sendToJiraAction} />
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
