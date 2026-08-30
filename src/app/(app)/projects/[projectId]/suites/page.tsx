import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ProjectTabs } from "@/components/layout/project-tabs";
import { runSuiteNow } from "@/lib/actions/suites";

export default async function SuitesPage({
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

  const { data: suites } = await supabase
    .from("test_suites")
    .select("id, name, created_at, test_suite_cases(test_case_id)")
    .eq("project_id", projectId)
    .order("name");

  const { data: runs } = await supabase
    .from("test_runs")
    .select("id, suite_id, created_at, test_run_cases(status)")
    .eq("project_id", projectId)
    .not("suite_id", "is", null)
    .order("created_at", { ascending: false });

  function lastRunFor(suiteId: string) {
    const run = (runs ?? []).find((r) => r.suite_id === suiteId);
    if (!run) return null;
    const cases = run.test_run_cases ?? [];
    const total = cases.length;
    const passed = cases.filter((c) => c.status === "passed").length;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
    return { id: run.id, createdAt: run.created_at, passRate, total };
  }

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project?.name ?? "Project", href: `/projects/${projectId}/test-cases` },
          { label: "Suites" },
        ]}
      />
      <PageHeader
        title="Suites"
        description="Reusable, named sets of test cases you can re-run — e.g. a Regression suite you run every release."
        action={
          <Link href={`/projects/${projectId}/suites/new`}>
            <Button>New suite</Button>
          </Link>
        }
      />
      <ProjectTabs projectId={projectId} />

      <div className="mt-6">
      {!suites || suites.length === 0 ? (
        <Card className="p-8 text-center text-sm text-ink-tertiary">
          No suites yet.{" "}
          <Link href={`/projects/${projectId}/suites/new`} className="font-medium text-primary">
            Create one
          </Link>
          .
        </Card>
      ) : (
        <Card className="divide-y divide-border-light">
          {suites.map((suite) => {
            const lastRun = lastRunFor(suite.id);
            const runAction = runSuiteNow.bind(null, projectId, suite.id);
            return (
              <div
                key={suite.id}
                className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-paper-surface"
              >
                <Link href={`/projects/${projectId}/suites/${suite.id}`} className="min-w-0 flex-1">
                  <div className="font-ui-label font-semibold text-ink-primary">{suite.name}</div>
                  <div className="text-xs text-ink-tertiary">
                    {suite.test_suite_cases?.length ?? 0} test case
                    {(suite.test_suite_cases?.length ?? 0) === 1 ? "" : "s"}
                    {lastRun ? (
                      <>
                        {" · "}Last run {new Date(lastRun.createdAt).toLocaleDateString()} ·{" "}
                        <span
                          className={lastRun.passRate >= 80 ? "text-pass" : "text-fail"}
                        >
                          {lastRun.passRate}% pass
                        </span>
                      </>
                    ) : (
                      " · Never run"
                    )}
                  </div>
                </Link>
                {lastRun && <Badge tone={lastRun.passRate >= 80 ? "green" : "red"}>{lastRun.passRate}%</Badge>}
                <form action={runAction}>
                  <Button type="submit" variant="secondary">
                    Run now
                  </Button>
                </form>
              </div>
            );
          })}
        </Card>
      )}
      </div>
    </div>
  );
}
