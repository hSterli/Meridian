import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { TestCasePicker } from "@/components/test-cases/test-case-picker";
import { addTestCasesToRun } from "@/lib/actions/runs";

export default async function AddCasesToRunPage({
  params,
}: {
  params: Promise<{ projectId: string; runId: string }>;
}) {
  const { projectId, runId } = await params;
  const supabase = await createClient();

  const { data: run } = await supabase
    .from("test_runs")
    .select("id, name")
    .eq("id", runId)
    .single();

  if (!run) notFound();

  const { data: existing } = await supabase
    .from("test_run_cases")
    .select("test_case_id")
    .eq("run_id", runId);

  const existingIds = new Set((existing ?? []).map((r) => r.test_case_id));

  const { data: allTestCases } = await supabase
    .from("test_cases")
    .select("id, title, priority")
    .eq("project_id", projectId)
    .eq("status", "active")
    .order("title");

  const addableTestCases = (allTestCases ?? []).filter((tc) => !existingIds.has(tc.id));

  async function action(formData: FormData) {
    "use server";
    await addTestCasesToRun(projectId, runId, formData);
    redirect(`/projects/${projectId}/runs/${runId}`);
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title={`Add test cases to “${run.name}”`} />
      <Card className="p-6">
        <form action={action} className="space-y-4">
          <TestCasePicker testCases={addableTestCases} />
          <Button type="submit" disabled={addableTestCases.length === 0}>
            Add to run
          </Button>
        </form>
      </Card>
    </div>
  );
}
