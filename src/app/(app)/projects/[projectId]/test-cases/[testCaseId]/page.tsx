import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { TestCaseForm } from "@/components/test-cases/test-case-form";
import { updateTestCase, deleteTestCase } from "@/lib/actions/test-cases";
import { AttachmentsPanel } from "@/components/test-cases/attachments-panel";
import { uploadAttachment, deleteAttachment } from "@/lib/actions/attachments";
import type { TestStep } from "@/lib/types/database";

export default async function TestCaseDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; testCaseId: string }>;
}) {
  const { projectId, testCaseId } = await params;
  const supabase = await createClient();

  const { data: testCase } = await supabase
    .from("test_cases")
    .select("*, test_case_tag_links(test_case_tags(name)), test_case_features(name)")
    .eq("id", testCaseId)
    .single();

  if (!testCase) notFound();

  const { data: versions } = await supabase
    .from("test_case_versions")
    .select("version, changed_at")
    .eq("test_case_id", testCaseId)
    .order("version", { ascending: false });

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

  const { data: attachmentRows } = await supabase
    .from("test_case_attachments")
    .select("id, storage_path, file_name, file_size, uploaded_at")
    .eq("test_case_id", testCaseId)
    .order("uploaded_at", { ascending: false });

  const attachments = await Promise.all(
    (attachmentRows ?? []).map(async (a) => {
      const { data: signed } = await supabase.storage
        .from("test-case-attachments")
        .createSignedUrl(a.storage_path, 300);
      return {
        id: a.id,
        storagePath: a.storage_path,
        fileName: a.file_name,
        fileSize: a.file_size,
        uploadedAt: a.uploaded_at,
        downloadUrl: signed?.signedUrl ?? null,
      };
    })
  );

  const updateAction = updateTestCase.bind(null, projectId, testCaseId);
  const deleteAction = deleteTestCase.bind(null, projectId, testCaseId);
  const uploadAction = uploadAttachment.bind(null, projectId, testCaseId);
  const deleteAttachmentAction = deleteAttachment.bind(null, projectId, testCaseId);
  const tagNames = (testCase.test_case_tag_links ?? [])
    .map((l: { test_case_tags: { name: string } | null }) => l.test_case_tags?.name)
    .filter((n: string | undefined): n is string => Boolean(n));
  const featureName = (
    testCase.test_case_features as { name: string } | { name: string }[] | null
  );
  const feature = Array.isArray(featureName) ? featureName[0]?.name : featureName?.name;

  return (
    <div className="grid max-w-4xl grid-cols-1 gap-6 lg:grid-cols-[1fr_240px]">
      <div>
        <PageHeader
          title={testCase.title}
          description={`v${testCase.version} · Report an issue against this case →`}
          action={
            <Link
              href={`/projects/${projectId}/issues/new?testCaseId=${testCaseId}`}
              className="text-sm font-medium text-primary hover:text-primary"
            >
              Report issue
            </Link>
          }
        />
        <Card className="p-6">
          <TestCaseForm
            action={updateAction}
            submitLabel="Save changes"
            features={(features ?? []).map((f) => f.name)}
            orgMembers={(orgMembers ?? []).map((m) => ({ user_id: m.user_id, email: m.email }))}
            initialValues={{
              title: testCase.title,
              preconditions: testCase.preconditions,
              priority: testCase.priority,
              status: testCase.status,
              steps: testCase.steps as TestStep[],
              tags: tagNames,
              feature,
              sprintNumber: testCase.sprint_number,
              assignedTo: testCase.assigned_to,
              automationStatus: testCase.automation_status,
              automationScriptRef: testCase.automation_script_ref,
              referenceLink: testCase.reference_link,
            }}
          />
        </Card>
        <form action={deleteAction} className="mt-4">
          <Button type="submit" variant="danger">
            Delete test case
          </Button>
        </form>
      </div>

      <div className="space-y-6">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-ink-secondary">Version history</h2>
          <Card className="divide-y divide-border-light">
            <div className="px-3 py-2 text-sm text-ink-secondary">
              v{testCase.version} <span className="text-xs text-ink-tertiary">current</span>
            </div>
            {(versions ?? []).map((v) => (
              <div key={v.version} className="px-3 py-2 text-sm text-ink-tertiary">
                v{v.version}{" "}
                <span className="text-xs text-ink-tertiary">
                  {new Date(v.changed_at).toLocaleString()}
                </span>
              </div>
            ))}
          </Card>
        </div>

        <AttachmentsPanel
          attachments={attachments}
          uploadAction={uploadAction}
          deleteAction={deleteAttachmentAction}
        />
      </div>
    </div>
  );
}
