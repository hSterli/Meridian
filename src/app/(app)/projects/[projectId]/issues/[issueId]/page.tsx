import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { updateIssueStatus, deleteIssue } from "@/lib/actions/issues";
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

  const deleteAction = deleteIssue.bind(null, projectId, issueId);

  return (
    <div className="max-w-2xl">
      <PageHeader
        title={issue.title}
        action={<Badge tone="indigo">{issue.severity}</Badge>}
      />

      <Card className="p-6">
        {issue.description && (
          <p className="mb-4 whitespace-pre-wrap text-sm text-slate-700">{issue.description}</p>
        )}

        {issue.test_cases && (
          <p className="mb-4 text-sm text-slate-500">
            Linked test case:{" "}
            <Link
              href={`/projects/${projectId}/test-cases/${issue.test_cases.id}`}
              className="font-medium text-indigo-600"
            >
              {issue.test_cases.title}
            </Link>
          </p>
        )}

        <div className="mb-2 text-sm font-medium text-slate-700">Status</div>
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
