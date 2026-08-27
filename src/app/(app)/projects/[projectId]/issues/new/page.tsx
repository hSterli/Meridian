import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { IssueForm } from "@/components/issues/issue-form";
import { createIssue } from "@/lib/actions/issues";

export default async function NewIssuePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ testCaseId?: string; runCaseId?: string }>;
}) {
  const { projectId } = await params;
  const { testCaseId, runCaseId } = await searchParams;
  const action = createIssue.bind(null, projectId);
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .single();

  let linkedTitle: string | undefined;
  if (testCaseId) {
    const { data } = await supabase
      .from("test_cases")
      .select("title")
      .eq("id", testCaseId)
      .maybeSingle();
    linkedTitle = data?.title;
  }

  return (
    <div className="max-w-lg">
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project?.name ?? "Project", href: `/projects/${projectId}/test-cases` },
          { label: "Issues", href: `/projects/${projectId}/issues` },
          { label: "New" },
        ]}
      />
      <PageHeader title="New issue" />
      <Card className="p-6">
        <IssueForm
          action={action}
          linkedTestCaseId={testCaseId}
          linkedRunCaseId={runCaseId}
          linkedTestCaseTitle={linkedTitle}
        />
      </Card>
    </div>
  );
}
