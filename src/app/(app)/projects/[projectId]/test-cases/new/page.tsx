import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { TestCaseForm } from "@/components/test-cases/test-case-form";
import { createTestCase } from "@/lib/actions/test-cases";
import type { TestCaseCustomFieldType } from "@/lib/types/database";

export default async function NewTestCasePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ suiteId?: string }>;
}) {
  const { projectId } = await params;
  const { suiteId } = await searchParams;
  const action = createTestCase.bind(null, projectId);

  const supabase = await createClient();
  const { data: features } = await supabase
    .from("test_case_features")
    .select("name")
    .eq("project_id", projectId)
    .order("name");

  const { data: project } = await supabase
    .from("projects")
    .select("org_id")
    .eq("id", projectId)
    .single();

  const { data: orgMembers } = project
    ? await supabase.rpc("get_org_members", { check_org_id: project.org_id })
    : { data: [] };

  const { data: suites } = await supabase
    .from("test_suites")
    .select("id, name")
    .eq("project_id", projectId)
    .order("name");

  const { data: customFieldDefs } = await supabase
    .from("test_case_custom_fields")
    .select("id, name, field_type, options")
    .eq("project_id", projectId)
    .order("display_order")
    .order("created_at");

  return (
    <div className="max-w-2xl">
      <PageHeader title="New test case" />
      <Card className="p-6">
        <TestCaseForm
          action={action}
          submitLabel="Create test case"
          features={(features ?? []).map((f) => f.name)}
          orgMembers={(orgMembers ?? []).map((m) => ({ user_id: m.user_id, email: m.email }))}
          suites={suites ?? []}
          defaultSuiteId={suiteId}
          customFields={(customFieldDefs ?? []).map((f) => ({
            id: f.id,
            name: f.name,
            field_type: f.field_type as TestCaseCustomFieldType,
            options: (f.options as string[]) ?? [],
          }))}
        />
      </Card>
    </div>
  );
}
