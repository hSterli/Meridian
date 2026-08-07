import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { SnapshotRagEditor } from "@/components/reports/snapshot-rag-editor";
import type { WeeklyMetrics } from "@/lib/weekly-report-metrics";

function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export default async function WeeklyReportSnapshotPage({
  params,
}: {
  params: Promise<{ projectId: string; snapshotId: string }>;
}) {
  const { projectId, snapshotId } = await params;
  const supabase = await createClient();

  const { data: snapshot } = await supabase
    .from("weekly_report_snapshots")
    .select("id, week_ending, rag_status, highlights, metrics, created_at")
    .eq("id", snapshotId)
    .single();

  if (!snapshot) notFound();

  const metrics = snapshot.metrics as unknown as WeeklyMetrics;

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title={`Report — Week Ending ${snapshot.week_ending}`}
        description={`Captured ${new Date(snapshot.created_at).toLocaleString()}`}
      />

      <Card className="p-5">
        <SnapshotRagEditor
          projectId={projectId}
          snapshotId={snapshot.id}
          ragStatus={snapshot.rag_status}
          highlights={snapshot.highlights}
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
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-ink-tertiary">
              <th className="pb-2">Date</th>
              <th className="pb-2">Planned</th>
              <th className="pb-2">Actual</th>
              <th className="pb-2">Passed</th>
              <th className="pb-2">Failed</th>
              <th className="pb-2">Blocked</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {metrics.dailyExecution.map((d) => (
              <tr key={d.date}>
                <td className="py-2">{d.date}</td>
                <td className="py-2">{d.planned}</td>
                <td className="py-2">{d.actual}</td>
                <td className="py-2">{d.passed}</td>
                <td className="py-2">{d.failed}</td>
                <td className="py-2">{d.blocked}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {metrics.moduleBreakdown.map((m) => (
              <tr key={m.feature}>
                <td className="py-2">{m.feature}</td>
                <td className="py-2">{m.total}</td>
                <td className="py-2">{m.executed}</td>
                <td className="py-2">{m.passed}</td>
                <td className="py-2">{m.failed}</td>
                <td className="py-2">{m.blocked}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
