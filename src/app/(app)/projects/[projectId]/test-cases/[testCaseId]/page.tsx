import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { TestCaseForm } from "@/components/test-cases/test-case-form";
import { updateTestCase, deleteTestCase } from "@/lib/actions/test-cases";
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
    .select("*, test_case_tag_links(test_case_tags(name))")
    .eq("id", testCaseId)
    .single();

  if (!testCase) notFound();

  const { data: versions } = await supabase
    .from("test_case_versions")
    .select("version, changed_at")
    .eq("test_case_id", testCaseId)
    .order("version", { ascending: false });

  const updateAction = updateTestCase.bind(null, projectId, testCaseId);
  const deleteAction = deleteTestCase.bind(null, projectId, testCaseId);
  const tagNames = (testCase.test_case_tag_links ?? [])
    .map((l: { test_case_tags: { name: string } | null }) => l.test_case_tags?.name)
    .filter((n: string | undefined): n is string => Boolean(n));

  return (
    <div className="grid max-w-4xl grid-cols-1 gap-6 lg:grid-cols-[1fr_240px]">
      <div>
        <PageHeader
          title={testCase.title}
          description={`v${testCase.version} · Report an issue against this case →`}
          action={
            <Link
              href={`/projects/${projectId}/issues/new?testCaseId=${testCaseId}`}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
            >
              Report issue
            </Link>
          }
        />
        <Card className="p-6">
          <TestCaseForm
            action={updateAction}
            submitLabel="Save changes"
            initialValues={{
              title: testCase.title,
              preconditions: testCase.preconditions,
              priority: testCase.priority,
              status: testCase.status,
              steps: testCase.steps as TestStep[],
              tags: tagNames,
            }}
          />
        </Card>
        <form action={deleteAction} className="mt-4">
          <Button type="submit" variant="danger">
            Delete test case
          </Button>
        </form>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Version history</h2>
        <Card className="divide-y divide-slate-100">
          <div className="px-3 py-2 text-sm text-slate-600">
            v{testCase.version} <span className="text-xs text-slate-400">current</span>
          </div>
          {(versions ?? []).map((v) => (
            <div key={v.version} className="px-3 py-2 text-sm text-slate-500">
              v{v.version}{" "}
              <span className="text-xs text-slate-400">
                {new Date(v.changed_at).toLocaleString()}
              </span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
