import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { NewRunForm } from "@/components/runs/new-run-form";
import { createRun } from "@/lib/actions/runs";

export default async function NewRunPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  const { data: testCases } = await supabase
    .from("test_cases")
    .select("id, title, priority")
    .eq("project_id", projectId)
    .eq("status", "active")
    .order("title");

  const action = createRun.bind(null, projectId);

  return (
    <div className="max-w-2xl">
      <PageHeader title="New test run" description="Pick which test cases go into this run." />
      <Card className="p-6">
        <NewRunForm action={action} testCases={testCases ?? []} />
      </Card>
    </div>
  );
}
