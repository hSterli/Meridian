import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import { Card, Badge } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";

export default async function DashboardPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrgId) redirect("/onboarding");

  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, key")
    .eq("org_id", ctx.activeOrgId);

  const projectIds = (projects ?? []).map((p) => p.id);

  if (projectIds.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <PageHeader title="Dashboard" />
        <Card className="p-8 text-center text-sm text-slate-500">
          No projects yet.{" "}
          <Link href="/projects/new" className="font-medium text-indigo-600">
            Create one
          </Link>{" "}
          to see cross-project reporting here.
        </Card>
      </div>
    );
  }

  const [{ count: testCaseCount }, { data: runs }, { count: openIssueCount }, { data: runCases }] =
    await Promise.all([
      supabase
        .from("test_cases")
        .select("id", { count: "exact", head: true })
        .in("project_id", projectIds),
      supabase
        .from("test_runs")
        .select("id, name, project_id, status, created_at, completed_at")
        .in("project_id", projectIds)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("issues")
        .select("id", { count: "exact", head: true })
        .in("project_id", projectIds)
        .in("status", ["open", "in_progress"]),
      supabase
        .from("test_run_cases")
        .select("status, test_case_id, test_cases(title), test_runs!inner(project_id)")
        .in("test_runs.project_id", projectIds)
        .neq("status", "pending"),
    ]);

  const runIds = (runs ?? []).map((r) => r.id);
  const { data: recentRunCases } = runIds.length
    ? await supabase
        .from("test_run_cases")
        .select("run_id, status")
        .in("run_id", runIds)
    : { data: [] as { run_id: string; status: string }[] };

  const runStats = (runs ?? []).map((run) => {
    const cases = (recentRunCases ?? []).filter((rc) => rc.run_id === run.id);
    const total = cases.length;
    const passed = cases.filter((c) => c.status === "passed").length;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
    const project = (projects ?? []).find((p) => p.id === run.project_id);
    return { ...run, total, passed, passRate, projectName: project?.name ?? "" };
  });

  // Flaky-test tracker: test cases with both a pass and a fail somewhere in history.
  const byTestCase = new Map<string, { title: string; passed: number; failed: number }>();
  for (const rc of runCases ?? []) {
    const title = (rc as unknown as { test_cases: { title: string } | null }).test_cases?.title;
    if (!title) continue;
    const entry = byTestCase.get(rc.test_case_id) ?? { title, passed: 0, failed: 0 };
    if (rc.status === "passed") entry.passed += 1;
    if (rc.status === "failed") entry.failed += 1;
    byTestCase.set(rc.test_case_id, entry);
  }
  const flaky = Array.from(byTestCase.values())
    .filter((e) => e.passed > 0 && e.failed > 0)
    .sort((a, b) => b.failed - a.failed)
    .slice(0, 5);

  const testRunsThisWeek = (runs ?? []).filter((r) => {
    const created = new Date(r.created_at);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return created >= weekAgo;
  }).length;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <PageHeader title="Dashboard" description="Cross-project view — no manual export needed." />

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Projects" value={projectIds.length} />
        <StatTile label="Test cases" value={testCaseCount ?? 0} />
        <StatTile label="Runs (7d)" value={testRunsThisWeek} />
        <StatTile
          label="Open issues"
          value={openIssueCount ?? 0}
          tone={(openIssueCount ?? 0) > 0 ? "red" : "green"}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Recent runs — pass/fail trend</h2>
          <Card className="divide-y divide-slate-100">
            {runStats.length === 0 && (
              <p className="p-4 text-sm text-slate-400">No runs yet.</p>
            )}
            {runStats.map((run) => (
              <Link
                key={run.id}
                href={`/projects/${run.project_id}/runs/${run.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900">{run.name}</div>
                  <div className="text-xs text-slate-400">{run.projectName}</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full bg-emerald-500"
                      style={{ width: `${run.passRate}%` }}
                    />
                  </div>
                  <span className="w-10 text-right text-xs text-slate-500">{run.passRate}%</span>
                </div>
              </Link>
            ))}
          </Card>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Flaky-test tracker</h2>
          <Card className="divide-y divide-slate-100">
            {flaky.length === 0 && (
              <p className="p-4 text-sm text-slate-400">
                No flaky tests detected yet — a test needs both a pass and a fail in history to show here.
              </p>
            )}
            {flaky.map((f) => (
              <div key={f.title} className="flex items-center justify-between px-4 py-3">
                <span className="truncate text-sm text-slate-800">{f.title}</span>
                <div className="flex gap-1">
                  <Badge tone="green">{f.passed} pass</Badge>
                  <Badge tone="red">{f.failed} fail</Badge>
                </div>
              </div>
            ))}
          </Card>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Coverage by project</h2>
        <Card className="divide-y divide-slate-100">
          {(projects ?? []).map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}/test-cases`}
              className="flex items-center justify-between px-4 py-3 hover:bg-slate-50"
            >
              <span className="text-sm font-medium text-slate-800">{p.name}</span>
              <span className="text-xs text-slate-400">{p.key}</span>
            </Link>
          ))}
        </Card>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: number;
  tone?: "slate" | "green" | "red";
}) {
  const toneClass =
    tone === "green" ? "text-emerald-600" : tone === "red" ? "text-red-600" : "text-slate-900";
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
    </Card>
  );
}
