import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ProjectTabs } from "@/components/layout/project-tabs";
import { NewSuiteForm } from "@/components/suites/new-suite-form";
import { createSuite } from "@/lib/actions/suites";

export default async function NewSuitePage({
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

  const action = createSuite.bind(null, projectId);

  return (
    <div className="max-w-2xl">
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project?.name ?? "Project", href: `/projects/${projectId}/test-cases` },
          { label: "Suites", href: `/projects/${projectId}/suites` },
          { label: "New" },
        ]}
      />
      <PageHeader
        title="New suite"
        description="Give it a name (e.g. Regression) and pick which test cases belong to it — you can add more later."
      />
      <ProjectTabs projectId={projectId} />
      <Card className="mt-6 p-6">
        <NewSuiteForm action={action} testCases={testCases ?? []} />
      </Card>
    </div>
  );
}
