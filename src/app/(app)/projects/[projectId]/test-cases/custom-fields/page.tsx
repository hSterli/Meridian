import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { CustomFieldsManager } from "@/components/test-cases/custom-fields-manager";
import { createCustomField, updateCustomField, deleteCustomField } from "@/lib/actions/custom-fields";
import type { TestCaseCustomFieldType } from "@/lib/types/database";

export default async function CustomFieldsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  const { data: fields } = await supabase
    .from("test_case_custom_fields")
    .select("id, name, field_type, options")
    .eq("project_id", projectId)
    .order("display_order")
    .order("created_at");

  const createAction = createCustomField.bind(null, projectId);
  const updateAction = updateCustomField.bind(null, projectId);
  const deleteAction = deleteCustomField.bind(null, projectId);

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Custom fields"
        description="Define per-project fields that show up on every test case."
        action={
          <Link
            href={`/projects/${projectId}/test-cases`}
            className="text-sm font-medium text-primary hover:text-primary"
          >
            ← Back to Test Cases
          </Link>
        }
      />
      <CustomFieldsManager
        fields={(fields ?? []).map((f) => ({
          id: f.id,
          name: f.name,
          field_type: f.field_type as TestCaseCustomFieldType,
          options: (f.options as string[]) ?? [],
        }))}
        createAction={createAction}
        updateAction={updateAction}
        deleteAction={deleteAction}
      />
    </div>
  );
}
