import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ProjectTabs } from "@/components/layout/project-tabs";
import { Card, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RagEditor } from "@/components/reports/rag-editor";
import { DailyExecutionTable } from "@/components/reports/daily-execution-table";
import { AutoRefresh } from "@/components/reports/auto-refresh";
import { computeWeeklyReportMetrics, getWeekdayRange } from "@/lib/weekly-report-metrics";
import { captureWeeklyReportSnapshot } from "@/lib/actions/weekly-reports";

function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export default async function WeeklyReportPage({
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

  const { data: draft } = await supabase
    .from("weekly_report_drafts")
    .select("rag_status, highlights")
    .eq("project_id", projectId)
    .single();

  const weekDates = getWeekdayRange(new Date());
  const metrics = await computeWeeklyReportMetrics(supabase, projectId, weekDates);
  const weekEnding = weekDates[weekDates.length - 1];

  async function captureAction() {
    "use server";
    // captureWeeklyReportSnapshot returns Promise<ActionState>, which
    // <form action> can't accept directly (it requires void | Promise<void>)
    // — this inline Server Action wrapper discards the return value instead
    // of surfacing it, matching how the "Capture" button doesn't display
    // inline errors (a rate-limit hit here is rare and non-critical; the
    // button can just be pressed again).
    await captureWeeklyReportSnapshot(projectId, weekEnding);
  }

  return (
    <div className="max-w-4xl space-y-6">
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project?.name ?? "Project", href: `/projects/${projectId}/test-cases` },
          { label: "Weekly Report" },
        ]}
      />
      <PageHeader
        title="Weekly Status Report"
        description={project?.name ?? ""}
        action={
          <div className="flex items-center gap-2">
            <AutoRefresh />
            <Link
              href={`/projects/${projectId}/reports/history`}
              className="text-sm font-medium text-primary hover:text-primary"
            >
              View history
            </Link>
            <form action={captureAction}>
              <Button type="submit" variant="primary">
                Capture this week&rsquo;s report
              </Button>
            </form>
          </div>
        }
      />
      <ProjectTabs projectId={projectId} />

      <Card className="p-5">
        <RagEditor
          projectId={projectId}
          ragStatus={draft?.rag_status ?? "green"}
          highlights={draft?.highlights ?? ""}
        />
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-secondary">Key Metrics</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <div className="text-xs text-ink-tertiary">Total Test Cases</div>
            <div className="text-lg font-semibold text-ink-primary">{metrics.totalTestCases}</div>
          </div>
          <div>
            <div className="text-xs text-ink-tertiary">Executed</div>
            <div className="text-lg font-semibold text-ink-primary">{metrics.executed}</div>
          </div>
          <div>
            <div className="text-xs text-ink-tertiary">% Complete</div>
            <div className="text-lg font-semibold text-ink-primary">
              {formatPercent(metrics.percentComplete)}
            </div>
          </div>
          <div>
            <div className="text-xs text-ink-tertiary">Pass Rate</div>
            <div className="text-lg font-semibold text-ink-primary">{formatPercent(metrics.passRate)}</div>
          </div>
          <div>
            <div className="text-xs text-ink-tertiary">Open Defects</div>
            <div className="text-lg font-semibold text-ink-primary">{metrics.openDefects}</div>
          </div>
          <div>
            <div className="text-xs text-ink-tertiary">Critical/High Open</div>
            <div className="text-lg font-semibold text-ink-primary">{metrics.criticalHighOpen}</div>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-secondary">Daily Test Execution</h2>
        <DailyExecutionTable projectId={projectId} days={metrics.dailyExecution} />
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink-secondary">Module / Test Area Progress</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-ink-tertiary">
              <th className="pb-2">Module</th>
              <th className="pb-2">Total</th>
              <th className="pb-2">Executed</th>
              <th className="pb-2">Passed</th>
              <th className="pb-2">Failed</th>
              <th className="pb-2">Blocked</th>
              <th className="pb-2">% Complete</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {metrics.moduleBreakdown.map((m) => {
              const pct = m.total === 0 ? 0 : m.executed / m.total;
              const tone = pct >= 0.8 ? "green" : pct > 0 ? "amber" : "red";
              return (
                <tr key={m.feature}>
                  <td className="py-2">{m.feature}</td>
                  <td className="py-2">{m.total}</td>
                  <td className="py-2">{m.executed}</td>
                  <td className="py-2">{m.passed}</td>
                  <td className="py-2">{m.failed}</td>
                  <td className="py-2">{m.blocked}</td>
                  <td className="py-2">
                    <Badge tone={tone}>{formatPercent(pct)}</Badge>
                  </td>
                </tr>
              );
            })}
            {metrics.moduleBreakdown.length === 0 && (
              <tr>
                <td colSpan={7} className="py-2 text-ink-tertiary">
                  No test cases in this project yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
