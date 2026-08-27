import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { NewRunForm } from "@/components/runs/new-run-form";
import { createRun } from "@/lib/actions/runs";

export default async function NewRunPage({
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

  const { data: testCases } = await supabase
    .from("test_cases")
    .select("id, title, priority")
    .eq("project_id", projectId)
    .eq("status", "active")
    .order("title");

  const { data: folders } = await supabase
    .from("run_folders")
    .select("name")
    .eq("project_id", projectId)
    .order("name");

  const action = createRun.bind(null, projectId);

  return (
    <div className="max-w-2xl">
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project?.name ?? "Project", href: `/projects/${projectId}/test-cases` },
          { label: "Runs", href: `/projects/${projectId}/runs` },
          { label: "New" },
        ]}
      />
      <PageHeader title="New test run" description="Pick which test cases go into this run." />
      <Card className="p-6">
        <NewRunForm
          action={action}
          testCases={testCases ?? []}
          folders={(folders ?? []).map((f) => f.name)}
        />
      </Card>
    </div>
  );
}
