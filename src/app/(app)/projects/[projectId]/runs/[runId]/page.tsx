import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { RunExecutor, type RunCaseItem } from "@/components/runs/run-executor";
import { deleteRun } from "@/lib/actions/runs";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; runId: string }>;
}) {
  const { projectId, runId } = await params;
  const supabase = await createClient();

  const { data: run } = await supabase
    .from("test_runs")
    .select("id, name, status")
    .eq("id", runId)
    .single();

  if (!run) notFound();

  const { data: runCases } = await supabase
    .from("test_run_cases")
    .select(
      "id, status, notes, test_cases(id, title, preconditions, steps, test_case_features(name))"
    )
    .eq("run_id", runId)
    .order("order_index");

  // postgrest-js infers many-to-one embeds as arrays without generated
  // Relationships metadata; test_run_cases.test_case_id -> test_cases.id is
  // actually one row, so unwrap it.
  const items: RunCaseItem[] = (runCases ?? []).map((rc) => {
    const testCase = Array.isArray(rc.test_cases) ? rc.test_cases[0] : rc.test_cases;
    const linkedFeature = testCase.test_case_features as
      | { name: string }
      | { name: string }[]
      | null;
    const feature = Array.isArray(linkedFeature) ? linkedFeature[0]?.name : linkedFeature?.name;
    return {
      id: rc.id,
      status: rc.status,
      notes: rc.notes,
      test_case: {
        id: testCase.id,
        title: testCase.title,
        preconditions: testCase.preconditions,
        steps: testCase.steps as RunCaseItem["test_case"]["steps"],
        feature: feature ?? null,
      },
    };
  });

  const deleteAction = deleteRun.bind(null, projectId, runId);

  return (
    <div>
      <PageHeader
        title={run.name}
        action={
          <div className="flex items-center gap-2">
            <Link href={`/projects/${projectId}/runs/${runId}/add-cases`}>
              <Button variant="secondary">Add test cases</Button>
            </Link>
            <form action={deleteAction}>
              <Button type="submit" variant="ghost">
                Delete run
              </Button>
            </form>
          </div>
        }
      />
      <RunExecutor projectId={projectId} runId={runId} cases={items} />
    </div>
  );
}
