import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
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

  let linkedTitle: string | undefined;
  if (testCaseId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("test_cases")
      .select("title")
      .eq("id", testCaseId)
      .maybeSingle();
    linkedTitle = data?.title;
  }

  return (
    <div className="max-w-lg">
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
