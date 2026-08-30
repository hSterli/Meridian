import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ProjectTabs } from "@/components/layout/project-tabs";
import type { IssueSeverity, IssueStatus } from "@/lib/types/database";

const SEVERITY_TONE: Record<IssueSeverity, "slate" | "amber" | "red" | "indigo"> = {
  low: "slate",
  medium: "indigo",
  high: "amber",
  critical: "red",
};

const STATUS_TONE: Record<IssueStatus, "slate" | "amber" | "green" | "blue"> = {
  open: "amber",
  in_progress: "blue",
  resolved: "green",
  closed: "slate",
};

export default async function IssuesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .single();

  const { data: issues } = await supabase
    .from("issues")
    .select("id, title, status, severity, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project?.name ?? "Project", href: `/projects/${projectId}/test-cases` },
          { label: "Issues" },
        ]}
      />
      <PageHeader
        title="Issues"
        action={
          <Link href={`/projects/${projectId}/issues/new`}>
            <Button>New issue</Button>
          </Link>
        }
      />
      <ProjectTabs projectId={projectId} />

      <div className="mt-6">
        {!issues || issues.length === 0 ? (
          <Card className="p-8 text-center text-sm text-ink-tertiary">No issues reported yet.</Card>
        ) : (
          <Card className="divide-y divide-border-light">
            {issues.map((issue) => (
              <Link
                key={issue.id}
                href={`/projects/${projectId}/issues/${issue.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-paper-surface"
              >
                <div className="font-medium text-ink-primary">{issue.title}</div>
                <div className="flex gap-2">
                  <Badge tone={SEVERITY_TONE[issue.severity as IssueSeverity]}>{issue.severity}</Badge>
                  <Badge tone={STATUS_TONE[issue.status as IssueStatus]}>
                    {issue.status.replace("_", " ")}
                  </Badge>
                </div>
              </Link>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
