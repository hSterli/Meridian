import Link from "next/link";
import { redirect } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { GitBranch, Gauge } from "lucide-react";
import { getUserContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { DashboardProjectFilter } from "@/components/dashboard/project-filter";
import { computeFlakyTests, type RawFlakyRunCaseRow } from "@/lib/flaky-tests";
import { computeBlockedTests, type RawBlockedRunCaseRow } from "@/lib/blocked-tests";
import { computePassRateTrend, type RawTrendRunCaseRow } from "@/lib/pass-rate-trend";
import { buildAreaChartPath } from "@/lib/pass-rate-chart-geometry";

const PLANNED_REPORTS = [
  {
    icon: GitBranch,
    title: "Coverage by requirement",
    description: "Traceability from requirements through test cases to run results.",
  },
  {
    icon: Gauge,
    title: "Team velocity",
    description: "Test cases authored and runs executed per team member, per sprint.",
  },
];

const CHART_WIDTH = 600;
const CHART_HEIGHT = 150;

// A test_runs!inner(...) or test_cases(...) join can come back as either a
// single object or a one-element array depending on how Supabase infers the
// relationship's cardinality — this codebase already handles that
// defensively elsewhere (see tagName/featureName in the Test Cases list
// page), so these do the same rather than assuming one shape.
function joinedTitle(rc: { test_cases: { title: string } | { title: string }[] | null }) {
  return Array.isArray(rc.test_cases) ? rc.test_cases[0]?.title : rc.test_cases?.title;
}
function joinedProjectId(rc: { test_runs: { project_id: string } | { project_id: string }[] | null }) {
  return Array.isArray(rc.test_runs) ? rc.test_runs[0]?.project_id : rc.test_runs?.project_id;
}
function joinedRun(rc: {
  test_runs:
    | { project_id: string; name: string; status: string }
    | { project_id: string; name: string; status: string }[]
    | null;
}) {
  return Array.isArray(rc.test_runs) ? rc.test_runs[0] : (rc.test_runs ?? undefined);
}

export default async function ReportsPage({
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
    .select("id, name")
    .eq("org_id", ctx.activeOrgId);

  const allProjectIds = (projects ?? []).map((p) => p.id);
  const isValidSelection = !!selectedProjectId && allProjectIds.includes(selectedProjectId);
  const projectIds = isValidSelection ? [selectedProjectId] : allProjectIds;
  const projectNameById = new Map((projects ?? []).map((p) => [p.id, p.name]));

  const filterAction = (
    <DashboardProjectFilter projects={(projects ?? []).map((p) => ({ id: p.id, name: p.name }))} />
  );

  const { data: runCases } = projectIds.length
    ? await supabase
        .from("test_run_cases")
        .select(
          "status, test_case_id, run_id, executed_at, notes, test_cases(title), test_runs!inner(project_id, name, status)"
        )
        .in("test_runs.project_id", projectIds)
        .neq("status", "pending")
    : { data: [] as never[] };

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

  const { data: trendRunCases } = projectIds.length
    ? await supabase
        .from("test_run_cases")
        .select("status, executed_at, test_runs!inner(project_id)")
        .in("test_runs.project_id", projectIds)
        .gte("executed_at", thirtyDaysAgo.toISOString())
        .in("status", ["passed", "failed"])
    : { data: [] as never[] };

  const testCaseProjectId = new Map<string, string>();
  const flakyRows: RawFlakyRunCaseRow[] = [];
  const blockedRows: RawBlockedRunCaseRow[] = [];
  for (const rc of runCases ?? []) {
    const title = joinedTitle(rc);
    const projectId = joinedProjectId(rc);
    if (!title || !projectId) continue;
    testCaseProjectId.set(rc.test_case_id, projectId);
    flakyRows.push({
      testCaseId: rc.test_case_id,
      title,
      status: rc.status as RawFlakyRunCaseRow["status"],
      executedAt: (rc as unknown as { executed_at: string | null }).executed_at,
    });

    const run = joinedRun(rc);
    if (run) {
      blockedRows.push({
        testCaseId: rc.test_case_id,
        title,
        projectId,
        runId: (rc as unknown as { run_id: string }).run_id,
        runName: run.name,
        runStatus: run.status as RawBlockedRunCaseRow["runStatus"],
        status: rc.status as RawBlockedRunCaseRow["status"],
        executedAt: (rc as unknown as { executed_at: string | null }).executed_at,
        notes: (rc as unknown as { notes: string | null }).notes,
      });
    }
  }

  const trendRows: RawTrendRunCaseRow[] = (trendRunCases ?? []).map((rc) => ({
    status: rc.status as RawTrendRunCaseRow["status"],
    executedAt: (rc as unknown as { executed_at: string | null }).executed_at,
  }));

  const flaky = computeFlakyTests(flakyRows);
  const blocked = computeBlockedTests(blockedRows);
  const trend = computePassRateTrend(trendRows);
  const { linePoints, areaPoints } = buildAreaChartPath(trend, CHART_WIDTH, CHART_HEIGHT);

  return (
    <div className="max-w-[1400px]">
      <PageHeader
        title="Reports"
        description="The dashboard already covers cross-project pass/fail trend and the flaky-test tracker. Deeper, exportable report templates are coming next."
        action={filterAction}
      />

      <div className="mt-2">
        <h2 className="mb-3 font-headline-sm text-[17px] font-semibold text-ink-primary">
          Pass/fail trend
        </h2>
        <Card className="p-5">
          {trend.length === 0 ? (
            <p className="text-sm text-ink-tertiary">No pass/fail results in the last 30 days yet.</p>
          ) : (
            <>
              <svg
                viewBox={`0 -4 ${CHART_WIDTH} ${CHART_HEIGHT + 8}`}
                className="h-[150px] w-full"
              >
                {/* viewBox has 4px of vertical slack on each side so the
                    2.5px stroke isn't clipped at passRate 0 or 1, where
                    buildAreaChartPath places points exactly on y=0/y=height. */}
                <defs>
                  <linearGradient id="passRateFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1e8a5b" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#1e8a5b" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <polygon fill="url(#passRateFill)" points={areaPoints} />
                <polyline
                  fill="none"
                  stroke="#1e8a5b"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={linePoints}
                />
              </svg>
              <div className="mt-2 flex justify-between text-xs text-ink-tertiary">
                <span>{trend[0].date}</span>
                <span>{trend[trend.length - 1].date}</span>
              </div>
            </>
          )}
        </Card>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {PLANNED_REPORTS.map((r) => (
          <Card key={r.title} className="flex items-start gap-4 p-5 opacity-70">
            <div className="rounded-lg bg-meridian-soft p-2 text-primary">
              <r.icon size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-ui-label font-semibold text-ink-primary">{r.title}</p>
                <span className="rounded-full bg-surface-container-highest px-2 py-0.5 text-[10px] font-ui-label font-bold uppercase tracking-wide text-ink-tertiary">
                  Coming soon
                </span>
              </div>
              <p className="mt-1 text-sm text-ink-secondary">{r.description}</p>
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-8">
        <h2 className="mb-3 font-headline-sm text-[17px] font-semibold text-ink-primary">
          Flaky tests
        </h2>
        <Card className="divide-y divide-border-light">
          {flaky.length === 0 && (
            <p className="p-4 text-sm text-ink-tertiary">
              No flaky tests detected yet — a test needs at least 3 recent executions with a mix
              of pass and fail to show here.
            </p>
          )}
          {flaky.map((f) => {
            const projectId = testCaseProjectId.get(f.testCaseId);
            return (
              <Link
                key={f.testCaseId}
                href={`/projects/${projectId}/test-cases/${f.testCaseId}`}
                className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-paper-surface"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-ui-label font-semibold text-ink-primary">
                    {f.title}
                  </div>
                  <div className="text-xs text-ink-tertiary">
                    {projectId ? (projectNameById.get(projectId) ?? "") : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="green">{f.passed} pass</Badge>
                  <Badge tone="red">{f.failed} fail</Badge>
                  <span className="w-12 text-right font-mono-data text-xs font-bold text-fail">
                    {Math.round(f.score * 100)}%
                  </span>
                </div>
              </Link>
            );
          })}
        </Card>
      </div>

      <div className="mt-8">
        <h2 className="mb-3 font-headline-sm text-[17px] font-semibold text-ink-primary">
          Blocked tests
        </h2>
        <Card className="divide-y divide-border-light">
          {blocked.length === 0 && (
            <p className="p-4 text-sm text-ink-tertiary">No blocked tests right now.</p>
          )}
          {blocked.map((b) => (
            <Link
              key={`${b.runId}-${b.testCaseId}`}
              href={`/projects/${b.projectId}/runs/${b.runId}`}
              className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-paper-surface"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-ui-label font-semibold text-ink-primary">
                  {b.title}
                </div>
                <div className="text-xs text-ink-tertiary">
                  {b.runName} · {projectNameById.get(b.projectId) ?? ""}
                </div>
                {b.notes && (
                  <div className="mt-1 truncate text-xs italic text-ink-tertiary">{b.notes}</div>
                )}
              </div>
              <span className="whitespace-nowrap text-xs font-semibold text-fail">
                {formatDistanceToNow(new Date(b.blockedSince), { addSuffix: true })}
              </span>
            </Link>
          ))}
        </Card>
      </div>
    </div>
  );
}
