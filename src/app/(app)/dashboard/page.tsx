import Link from "next/link";
import { redirect } from "next/navigation";
import { FolderKanban, ListChecks, Zap, Bug } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import { Card, Badge } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { DashboardProjectFilter } from "@/components/dashboard/project-filter";
import { computeFlakyTests, type RawFlakyRunCaseRow } from "@/lib/flaky-tests";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrgId) redirect("/onboarding");

  const { project: selectedProjectId } = await searchParams;

  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, key")
    .eq("org_id", ctx.activeOrgId);

  const allProjectIds = (projects ?? []).map((p) => p.id);
  const isValidSelection =
    !!selectedProjectId && allProjectIds.includes(selectedProjectId);
  const projectIds = isValidSelection ? [selectedProjectId] : allProjectIds;

  const filterAction = (
    <DashboardProjectFilter projects={(projects ?? []).map((p) => ({ id: p.id, name: p.name }))} />
  );

  if (allProjectIds.length === 0) {
    return (
      <div className="mx-auto max-w-[1400px]">
        <PageHeader title="Dashboard" />
        <Card className="p-8 text-center text-sm text-ink-secondary">
          No projects yet.{" "}
          <Link href="/projects/new" className="font-semibold text-primary">
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
        .select("status, test_case_id, executed_at, test_cases(title), test_runs!inner(project_id)")
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

  const flakyRows: RawFlakyRunCaseRow[] = [];
  for (const rc of runCases ?? []) {
    const title = (rc as unknown as { test_cases: { title: string } | null }).test_cases?.title;
    if (!title) continue;
    flakyRows.push({
      testCaseId: rc.test_case_id,
      title,
      status: rc.status as RawFlakyRunCaseRow["status"],
      executedAt: (rc as unknown as { executed_at: string | null }).executed_at,
    });
  }
  const flaky = computeFlakyTests(flakyRows, { limit: 5 });

  const testRunsThisWeek = (runs ?? []).filter((r) => {
    const created = new Date(r.created_at);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return created >= weekAgo;
  }).length;

  const scopedProjects = isValidSelection
    ? (projects ?? []).filter((p) => p.id === selectedProjectId)
    : projects ?? [];

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Dashboard"
        description="Cross-project view — no manual export needed."
        action={filterAction}
      />

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile icon={FolderKanban} label="Projects" value={projectIds.length} />
        <StatTile icon={ListChecks} label="Test cases" value={testCaseCount ?? 0} />
        <StatTile icon={Zap} label="Runs (7d)" value={testRunsThisWeek} />
        <StatTile
          icon={Bug}
          label="Open issues"
          value={openIssueCount ?? 0}
          tone={(openIssueCount ?? 0) > 0 ? "red" : "green"}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 font-headline-sm text-[17px] font-semibold text-ink-primary">
            Recent runs — pass/fail trend
          </h2>
          <Card className="divide-y divide-border-light">
            {runStats.length === 0 && (
              <p className="p-4 text-sm text-ink-tertiary">No runs yet.</p>
            )}
            {runStats.map((run) => (
              <Link
                key={run.id}
                href={`/projects/${run.project_id}/runs/${run.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-paper-surface"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-ui-label font-semibold text-ink-primary">
                    {run.name}
                  </div>
                  <div className="text-xs text-ink-tertiary">{run.projectName}</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-container-highest">
                    <div className="h-full bg-pass" style={{ width: `${run.passRate}%` }} />
                  </div>
                  <span className="w-10 text-right font-mono-data text-xs font-bold text-pass">
                    {run.passRate}%
                  </span>
                </div>
              </Link>
            ))}
          </Card>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-headline-sm text-[17px] font-semibold text-ink-primary">
              Flaky-test tracker
            </h2>
            <Link href="/reports" className="text-xs font-semibold text-primary">
              See all →
            </Link>
          </div>
          <Card className="divide-y divide-border-light">
            {flaky.length === 0 && (
              <p className="p-4 text-sm text-ink-tertiary">
                No flaky tests detected yet — a test needs at least 3 recent executions with a
                mix of pass and fail to show here.
              </p>
            )}
            {flaky.map((f) => (
              <div key={f.title} className="flex items-center justify-between px-4 py-3">
                <span className="truncate text-sm text-ink-primary">{f.title}</span>
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
        <h2 className="mb-3 font-headline-sm text-[17px] font-semibold text-ink-primary">
          Coverage by project
        </h2>
        <Card className="divide-y divide-border-light">
          {scopedProjects.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}/test-cases`}
              className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-paper-surface"
            >
              <span className="text-sm font-ui-label font-semibold text-ink-primary">
                {p.name}
              </span>
              <span className="font-mono-data text-xs text-ink-tertiary">{p.key}</span>
            </Link>
          ))}
        </Card>
      </div>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  tone = "slate",
}: {
  icon: typeof FolderKanban;
  label: string;
  value: number;
  tone?: "slate" | "green" | "red";
}) {
  const toneClass = tone === "green" ? "text-pass" : tone === "red" ? "text-fail" : "text-ink-primary";
  const chipClass =
    tone === "green"
      ? "bg-pass-soft text-pass"
      : tone === "red"
        ? "bg-fail-soft text-fail"
        : "bg-meridian-soft text-primary";
  return (
    <Card className="p-4 transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className={`mb-3 inline-flex rounded-lg p-2 ${chipClass}`}>
        <Icon size={18} />
      </div>
      <div className="text-xs font-ui-label font-semibold uppercase tracking-wide text-ink-tertiary">
        {label}
      </div>
      <div className={`mt-1 font-headline-md text-2xl font-semibold ${toneClass}`}>{value}</div>
    </Card>
  );
}
