import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, Badge } from "@/components/ui/card";
import type { ReportRagStatus } from "@/lib/types/database";

function ragTone(status: ReportRagStatus): "red" | "amber" | "green" {
  return status;
}

export default async function WeeklyReportHistoryPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  const { data: snapshots } = await supabase
    .from("weekly_report_snapshots")
    .select("id, week_ending, rag_status, highlights, created_at")
    .eq("project_id", projectId)
    .order("week_ending", { ascending: false })
    .order("created_at", { ascending: false });

  const byWeek = new Map<string, typeof snapshots>();
  for (const s of snapshots ?? []) {
    const existing = byWeek.get(s.week_ending) ?? [];
    existing.push(s);
    byWeek.set(s.week_ending, existing);
  }

  return (
    <div className="max-w-4xl">
      <PageHeader title="Report History" description="Every captured weekly report for this project." />
      <div className="space-y-6">
        {Array.from(byWeek.entries()).map(([weekEnding, weekSnapshots]) => (
          <div key={weekEnding}>
            <h2 className="mb-2 text-sm font-semibold text-ink-secondary">Week ending {weekEnding}</h2>
            <Card className="divide-y divide-border-light">
              {weekSnapshots!.map((s, i) => (
                <Link
                  key={s.id}
                  href={`/projects/${projectId}/reports/history/${s.id}`}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-paper-muted"
                >
                  <div className="flex items-center gap-2">
                    <Badge tone={ragTone(s.rag_status)}>{s.rag_status}</Badge>
                    <span className="truncate text-ink-primary">
                      {s.highlights.slice(0, 80) || "No highlights"}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-ink-tertiary">
                    {i === 0 && (
                      <span className="rounded-full bg-surface-container-highest px-2 py-0.5 font-ui-label font-bold uppercase">
                        Current
                      </span>
                    )}
                    {new Date(s.created_at).toLocaleString()}
                  </div>
                </Link>
              ))}
            </Card>
          </div>
        ))}
        {(snapshots ?? []).length === 0 && (
          <p className="text-sm text-ink-tertiary">No reports captured yet.</p>
        )}
      </div>
    </div>
  );
}
