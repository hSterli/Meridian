import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { NewSuiteForm } from "@/components/suites/new-suite-form";
import { createSuite } from "@/lib/actions/suites";

export default async function NewSuitePage({
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

  const action = createSuite.bind(null, projectId);

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="New suite"
        description="Give it a name (e.g. Regression) and pick which test cases belong to it — you can add more later."
      />
      <Card className="p-6">
        <NewSuiteForm action={action} testCases={testCases ?? []} />
      </Card>
    </div>
  );
}
