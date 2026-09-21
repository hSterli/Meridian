import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ProjectTabs } from "@/components/layout/project-tabs";
import { RunFolderSidebar } from "@/components/runs/run-folder-sidebar";
import { RunsTable, type RunRow } from "@/components/runs/runs-table";
import type { RunStatus } from "@/lib/types/database";

export default async function RunsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ folder?: string; sort?: string; dir?: string }>;
}) {
  const { projectId } = await params;
  const { folder, sort = "updated", dir = "desc" } = await searchParams;

  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .single();

  const { data: folders } = await supabase
    .from("run_folders")
    .select("id, name")
    .eq("project_id", projectId)
    .order("name");

  const { data: runs } = await supabase
    .from("test_runs")
    .select("id, name, status, created_at, completed_at, folder_id, test_run_cases(id, status)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  // Stable per-project display IDs, independent of the current sort/filter —
  // assigned by creation order so they don't shuffle as you re-sort.
  const displayIds = new Map<string, number>();
  (runs ?? []).forEach((r, i) => displayIds.set(r.id, i + 1));

  let rows: RunRow[] = (runs ?? []).map((run) => {
    const cases = run.test_run_cases ?? [];
    return {
      id: run.id,
      displayId: displayIds.get(run.id) ?? 0,
      name: run.name,
      status: run.status as RunStatus,
      instances: cases.length,
      updatedAt: run.completed_at ?? run.created_at,
      folderId: run.folder_id,
      segments: {
        passed: cases.filter((c) => c.status === "passed").length,
        failed: cases.filter((c) => c.status === "failed").length,
        blocked: cases.filter((c) => c.status === "blocked").length,
        skipped: cases.filter((c) => c.status === "skipped").length,
        pending: cases.filter((c) => c.status === "pending").length,
      },
    };
  });

  if (folder) rows = rows.filter((r) => r.folderId === folder);

  const sortDir = dir === "asc" ? 1 : -1;
  rows = [...rows].sort((a, b) => {
    switch (sort) {
      case "name":
        return a.name.localeCompare(b.name) * sortDir;
      case "status":
        return a.status.localeCompare(b.status) * sortDir;
      case "instances":
        return (a.instances - b.instances) * sortDir;
      default:
        return (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()) * sortDir;
    }
  });

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Projects", href: "/projects" },
          { label: project?.name ?? "Project", href: `/projects/${projectId}/test-cases` },
          { label: "Runs" },
        ]}
      />
      <PageHeader
        title="Test Runs"
        action={
          <Link href={`/projects/${projectId}/runs/new`}>
            <Button>New run</Button>
          </Link>
        }
      />
      <ProjectTabs projectId={projectId} />

      <div className="mt-6 flex gap-6">
        <RunFolderSidebar projectId={projectId} folders={folders ?? []} />

        <div className="flex-1">
          {rows.length === 0 ? (
            <Card className="p-8 text-center text-sm text-ink-tertiary">
              No runs yet.{" "}
              <Link href={`/projects/${projectId}/runs/new`} className="font-medium text-primary">
                Start one
              </Link>
              .
            </Card>
          ) : (
            <RunsTable projectId={projectId} folders={folders ?? []} rows={rows} />
          )}
        </div>
      </div>
    </div>
  );
}
