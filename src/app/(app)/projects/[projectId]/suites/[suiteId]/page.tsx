import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { TestCasePicker } from "@/components/test-cases/test-case-picker";
import {
  addTestCasesToSuite,
  removeTestCaseFromSuite,
  runSuiteNow,
  deleteSuite,
} from "@/lib/actions/suites";

export default async function SuiteDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; suiteId: string }>;
}) {
  const { projectId, suiteId } = await params;
  const supabase = await createClient();

  const { data: suite } = await supabase
    .from("test_suites")
    .select("id, name")
    .eq("id", suiteId)
    .single();

  if (!suite) notFound();

  const { data: project } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .single();

  const { data: memberLinks } = await supabase
    .from("test_suite_cases")
    .select("test_case_id, test_cases(id, title, priority)")
    .eq("suite_id", suiteId);

  const members = (memberLinks ?? [])
    .map((l) => (Array.isArray(l.test_cases) ? l.test_cases[0] : l.test_cases))
    .filter((tc): tc is { id: string; title: string; priority: string } => Boolean(tc));

  const memberIds = new Set(members.map((m) => m.id));

  const { data: allTestCases } = await supabase
    .from("test_cases")
    .select("id, title, priority")
    .eq("project_id", projectId)
    .eq("status", "active")
    .order("title");

  const addableTestCases = (allTestCases ?? []).filter((tc) => !memberIds.has(tc.id));

  const { data: runHistory } = await supabase
    .from("test_runs")
    .select("id, name, created_at, test_run_cases(status)")
    .eq("suite_id", suiteId)
    .order("created_at", { ascending: false });

  const runRows = (runHistory ?? []).map((run) => {
    const cases = run.test_run_cases ?? [];
    const total = cases.length;
    const passed = cases.filter((c) => c.status === "passed").length;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
    return { id: run.id, name: run.name, createdAt: run.created_at, passRate, total };
  });

  const runAction = runSuiteNow.bind(null, projectId, suiteId);
  const addAction = addTestCasesToSuite.bind(null, projectId, suiteId);
  const deleteAction = deleteSuite.bind(null, projectId, suiteId);

  return (
    <div className="max-w-4xl">
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project?.name ?? "Project", href: `/projects/${projectId}/test-cases` },
          { label: "Suites", href: `/projects/${projectId}/suites` },
          { label: suite.name },
        ]}
      />
      <PageHeader
        title={suite.name}
        description={`${members.length} test case${members.length === 1 ? "" : "s"}${
          runRows.length > 0
            ? ` · Last run ${new Date(runRows[0].createdAt).toLocaleDateString()} · ${runRows[0].passRate}% pass`
            : " · Never run"
        }`}
        action={
          <div className="flex gap-2">
            <form action={runAction}>
              <Button type="submit" disabled={members.length === 0}>
                Run now
              </Button>
            </form>
            <form action={deleteAction}>
              <Button type="submit" variant="ghost">
                Delete suite
              </Button>
            </form>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-ink-secondary">Test cases in this suite</h2>
          <Card className="divide-y divide-border-light">
            {members.length === 0 && (
              <p className="p-4 text-sm text-ink-tertiary">
                No test cases yet — add some from the right.
              </p>
            )}
            {members.map((tc) => {
              const removeAction = removeTestCaseFromSuite.bind(null, projectId, suiteId, tc.id);
              return (
                <div key={tc.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="truncate text-sm text-ink-primary">{tc.title}</span>
                  <form action={removeAction}>
                    <button
                      type="submit"
                      className="shrink-0 text-xs font-medium text-fail hover:underline"
                    >
                      Remove
                    </button>
                  </form>
                </div>
              );
            })}
          </Card>

          {runRows.length > 0 && (
            <>
              <h2 className="mb-2 mt-6 text-sm font-semibold text-ink-secondary">Run history</h2>
              <Card className="divide-y divide-border-light">
                {runRows.map((run) => (
                  <Link
                    key={run.id}
                    href={`/projects/${projectId}/runs/${run.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-paper-surface"
                  >
                    <span className="text-sm text-ink-primary">
                      {new Date(run.createdAt).toLocaleDateString()}
                    </span>
                    <Badge tone={run.passRate >= 80 ? "green" : "red"}>{run.passRate}% pass</Badge>
                  </Link>
                ))}
              </Card>
            </>
          )}
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-ink-secondary">Add test cases</h2>
          <Card className="p-4">
            <form action={addAction} className="space-y-3">
              <TestCasePicker testCases={addableTestCases} />
              <Button type="submit" variant="secondary" disabled={addableTestCases.length === 0}>
                Add to suite
              </Button>
            </form>
            <div className="mt-3 border-t border-border-light pt-3 text-center">
              <Link
                href={`/projects/${projectId}/test-cases/new?suiteId=${suiteId}`}
                className="text-sm font-medium text-primary hover:underline"
              >
                + Create a new test case
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
