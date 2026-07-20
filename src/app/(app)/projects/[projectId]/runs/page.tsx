import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import type { RunStatus } from "@/lib/types/database";

const STATUS_TONE: Record<RunStatus, "slate" | "amber" | "green"> = {
  planned: "slate",
  in_progress: "amber",
  completed: "green",
};

export default async function RunsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const supabase = await createClient();

  const { data: runs } = await supabase
    .from("test_runs")
    .select("id, name, status, created_at, test_run_cases(id, status)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  return (
    <div>
      <PageHeader
        title="Test Runs"
        action={
          <Link href={`/projects/${projectId}/runs/new`}>
            <Button>New run</Button>
          </Link>
        }
      />

      {!runs || runs.length === 0 ? (
        <Card className="p-8 text-center text-sm text-ink-tertiary">
          No runs yet.{" "}
          <Link href={`/projects/${projectId}/runs/new`} className="font-medium text-primary">
            Start one
          </Link>
          .
        </Card>
      ) : (
        <Card className="divide-y divide-border-light">
          {runs.map((run) => {
            const total = run.test_run_cases?.length ?? 0;
            const passed = run.test_run_cases?.filter((c) => c.status === "passed").length ?? 0;
            const failed = run.test_run_cases?.filter((c) => c.status === "failed").length ?? 0;
            return (
              <Link
                key={run.id}
                href={`/projects/${projectId}/runs/${run.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-paper-surface"
              >
                <div>
                  <div className="font-medium text-ink-primary">{run.name}</div>
                  <div className="text-xs text-ink-tertiary">
                    {passed}/{total} passed
                    {failed > 0 && `, ${failed} failed`}
                  </div>
                </div>
                <Badge tone={STATUS_TONE[run.status as RunStatus]}>
                  {run.status.replace("_", " ")}
                </Badge>
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );
}
