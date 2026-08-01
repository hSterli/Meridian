import Link from "next/link";
import { Sparkles, PieChart, Download, SlidersHorizontal } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { TestCaseFilters } from "@/components/test-cases/test-case-filters";
import { ImportCsvForm } from "@/components/test-cases/import-csv-form";
import { TestCaseSuiteSidebar } from "@/components/test-cases/test-case-suite-sidebar";
import type { RunCaseStatus, TestCasePriority, TestCaseStatus } from "@/lib/types/database";

const PRIORITY_TONE: Record<TestCasePriority, "slate" | "amber" | "red" | "indigo"> = {
  low: "slate",
  medium: "indigo",
  high: "amber",
  critical: "red",
};

const RESULT_TONE: Record<RunCaseStatus, "slate" | "green" | "red" | "amber"> = {
  passed: "green",
  failed: "red",
  blocked: "amber",
  skipped: "slate",
  pending: "slate",
};

interface TestCaseRow {
  id: string;
  title: string;
  priority: string;
  status: string;
  sprint_number: number | null;
  assigned_to: string | null;
  test_case_tag_links?: { tag_id: string; test_case_tags: { name: string } | { name: string }[] | null }[];
  test_case_features?: { name: string } | { name: string }[] | null;
}

export default async function TestCasesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{
    q?: string;
    priority?: string;
    status?: string;
    tag?: string;
    feature?: string;
    groupBy?: string;
    suite?: string;
  }>;
}) {
  const { projectId } = await params;
  const { q, priority, status, tag, feature, groupBy, suite } = await searchParams;

  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("key, org_id")
    .eq("id", projectId)
    .single();

  const { data: features } = await supabase
    .from("test_case_features")
    .select("id, name")
    .eq("project_id", projectId)
    .order("name");

  const { data: suites } = await supabase
    .from("test_suites")
    .select("id, name")
    .eq("project_id", projectId)
    .order("name");

  let suiteCaseIds: Set<string> | null = null;
  if (suite) {
    const { data: suiteCases } = await supabase
      .from("test_suite_cases")
      .select("test_case_id")
      .eq("suite_id", suite);
    suiteCaseIds = new Set((suiteCases ?? []).map((r) => r.test_case_id));
  }

  let query = supabase
    .from("test_cases")
    .select(
      "id, title, priority, status, updated_at, sprint_number, assigned_to, test_case_tag_links(tag_id, test_case_tags(id, name, color)), test_case_features(name)"
    )
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false });

  if (q) query = query.ilike("title", `%${q}%`);
  if (priority) query = query.eq("priority", priority as TestCasePriority);
  if (status) query = query.eq("status", status as TestCaseStatus);
  if (feature) {
    const matched = (features ?? []).find((f) => f.name === feature);
    query = query.eq("feature_id", matched?.id ?? "00000000-0000-0000-0000-000000000000");
  }

  const { data: testCases } = await query;

  const { data: tags } = await supabase
    .from("test_case_tags")
    .select("id, name")
    .eq("project_id", projectId)
    .order("name");

  // Stable per-project display IDs, assigned by creation order so they
  // don't shuffle as you re-sort or filter (mirrors the runs list pattern).
  const { data: allByCreation } = await supabase
    .from("test_cases")
    .select("id")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  const displayIds = new Map<string, number>();
  (allByCreation ?? []).forEach((tc, i) => displayIds.set(tc.id, i + 1));

  const { data: orgMembers } = project
    ? await supabase.rpc("get_org_members", { check_org_id: project.org_id })
    : { data: [] };
  const ownerMap = new Map((orgMembers ?? []).map((m) => [m.user_id, m.email]));

  const { data: lastResultsRaw } = await supabase
    .from("test_run_cases")
    .select("test_case_id, status, executed_at, test_runs!inner(project_id)")
    .eq("test_runs.project_id", projectId)
    .not("executed_at", "is", null)
    .order("executed_at", { ascending: false });
  const lastResultMap = new Map<string, RunCaseStatus>();
  for (const r of lastResultsRaw ?? []) {
    if (!lastResultMap.has(r.test_case_id)) {
      lastResultMap.set(r.test_case_id, r.status as RunCaseStatus);
    }
  }

  function tagName(l: { test_case_tags: { name: string } | { name: string }[] | null }) {
    return Array.isArray(l.test_case_tags) ? l.test_case_tags[0]?.name : l.test_case_tags?.name;
  }

  function featureName(tc: TestCaseRow) {
    return Array.isArray(tc.test_case_features)
      ? tc.test_case_features[0]?.name
      : tc.test_case_features?.name;
  }

  let filtered: TestCaseRow[] = tag
    ? (testCases ?? []).filter((tc) => tc.test_case_tag_links?.some((l) => tagName(l) === tag))
    : (testCases ?? []);

  if (suiteCaseIds) {
    filtered = filtered.filter((tc) => suiteCaseIds!.has(tc.id));
  }

  function groupKeyFor(tc: TestCaseRow): string {
    if (groupBy === "sprint") {
      return tc.sprint_number != null ? `Sprint ${tc.sprint_number}` : "No sprint";
    }
    if (groupBy === "feature") {
      return featureName(tc) ?? "No feature";
    }
    return "";
  }

  const groups: { label: string; items: TestCaseRow[] }[] = [];
  if (groupBy === "feature" || groupBy === "sprint") {
    const byLabel = new Map<string, TestCaseRow[]>();
    for (const tc of filtered) {
      const label = groupKeyFor(tc);
      const bucket = byLabel.get(label) ?? [];
      bucket.push(tc);
      byLabel.set(label, bucket);
    }
    const labels = Array.from(byLabel.keys()).sort((a, b) => {
      if (groupBy === "sprint") {
        if (a === "No sprint") return 1;
        if (b === "No sprint") return -1;
        return Number(a.replace("Sprint ", "")) - Number(b.replace("Sprint ", ""));
      }
      if (a === "No feature") return 1;
      if (b === "No feature") return -1;
      return a.localeCompare(b);
    });
    for (const label of labels) {
      groups.push({ label, items: byLabel.get(label)! });
    }
  }

  function TestCaseRowItem({ tc }: { tc: TestCaseRow }) {
    const ownerEmail = tc.assigned_to ? ownerMap.get(tc.assigned_to) : undefined;
    const lastResult = lastResultMap.get(tc.id);
    return (
      <Link
        href={`/projects/${projectId}/test-cases/${tc.id}`}
        className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-paper-surface"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="shrink-0 font-mono text-xs text-ink-tertiary">
              {project?.key ?? "TC"}-{displayIds.get(tc.id) ?? "?"}
            </span>
            <span className="truncate font-ui-label font-semibold text-ink-primary">{tc.title}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {groupBy !== "feature" && featureName(tc) && (
              <Badge tone="indigo">{featureName(tc)}</Badge>
            )}
            {groupBy !== "sprint" && tc.sprint_number != null && (
              <Badge tone="blue">Sprint {tc.sprint_number}</Badge>
            )}
            {tc.test_case_tag_links?.map((l) =>
              tagName(l) ? (
                <Badge key={l.tag_id} tone="slate">
                  {tagName(l)}
                </Badge>
              ) : null
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {ownerEmail && (
            <span
              title={ownerEmail}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-meridian-soft text-[10px] font-bold text-meridian-dark"
            >
              {ownerEmail.slice(0, 2).toUpperCase()}
            </span>
          )}
          <Badge tone={lastResult ? RESULT_TONE[lastResult] : "slate"}>
            {lastResult ?? "No runs"}
          </Badge>
          <Badge tone={PRIORITY_TONE[tc.priority as TestCasePriority]}>{tc.priority}</Badge>
          <Badge tone={tc.status === "active" ? "green" : "slate"}>{tc.status}</Badge>
        </div>
      </Link>
    );
  }

  return (
    <div>
      <PageHeader
        title="Test Cases"
        action={
          <div className="flex gap-2">
            <a href={`/projects/${projectId}/test-cases/export`}>
              <Button variant="secondary">Export CSV</Button>
            </a>
            <Link href={`/projects/${projectId}/test-cases/new`}>
              <Button>New test case</Button>
            </Link>
          </div>
        }
      />

      <div className="flex gap-6">
        <aside className="w-56 shrink-0 space-y-4">
          <TestCaseSuiteSidebar suites={suites ?? []} />

          <Card className="p-3 opacity-60">
            <div className="flex items-center gap-2">
              <PieChart size={16} className="text-ink-tertiary" />
              <p className="font-ui-label text-xs font-bold uppercase tracking-wide text-ink-tertiary">
                Coverage
              </p>
              <span className="ml-auto rounded-full bg-surface-container-highest px-2 py-0.5 text-[9px] font-ui-label font-bold uppercase tracking-wide text-ink-tertiary">
                Coming soon
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-tertiary">
              Requirement coverage metrics will appear here.
            </p>
          </Card>

          <Card className="p-3">
            <p className="font-ui-label text-xs font-bold uppercase tracking-wide text-ink-tertiary">
              Quick actions
            </p>
            <a
              href={`/projects/${projectId}/test-cases/export`}
              className="mt-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-paper-muted hover:text-ink-primary"
            >
              <Download size={14} />
              Export as CSV
            </a>
            <Link
              href={`/projects/${projectId}/test-cases/custom-fields`}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-paper-muted hover:text-ink-primary"
            >
              <SlidersHorizontal size={14} />
              Manage custom fields
            </Link>
          </Card>

          <Card className="border-primary/30 bg-meridian-soft/40 p-3">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-meridian-dark" />
              <p className="font-ui-label text-xs font-bold uppercase tracking-wide text-meridian-dark">
                AI Case Generation
              </p>
              <span className="ml-auto rounded-full bg-meridian-dark px-2 py-0.5 text-[9px] font-ui-label font-bold uppercase tracking-wide text-white">
                Pro
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-secondary">
              Generate test cases from a requirements doc automatically.
            </p>
            <Button variant="secondary" className="mt-2 w-full" disabled>
              Upgrade to unlock
            </Button>
          </Card>
        </aside>

        <div className="flex-1">
          <div className="mb-4 flex items-center justify-between">
            <TestCaseFilters
              tags={(tags ?? []).map((t) => t.name)}
              features={(features ?? []).map((f) => f.name)}
            />
            <ImportCsvForm projectId={projectId} />
          </div>

          {filtered.length === 0 ? (
            <Card className="mt-4 p-8 text-center text-sm text-ink-secondary">
              No test cases match. {q || priority || status || tag || feature || suite ? "Try clearing filters." : ""}
            </Card>
          ) : groups.length > 0 ? (
            <div className="mt-4 space-y-6">
              {groups.map((group) => (
                <div key={group.label}>
                  <h2 className="mb-2 flex items-center gap-2 font-ui-label text-sm font-bold uppercase tracking-wide text-ink-tertiary">
                    {group.label}
                    <span className="rounded-full bg-surface-container-highest px-2 py-0.5 text-[11px] font-bold text-ink-secondary">
                      {group.items.length}
                    </span>
                  </h2>
                  <Card className="divide-y divide-border-light">
                    {group.items.map((tc) => (
                      <TestCaseRowItem key={tc.id} tc={tc} />
                    ))}
                  </Card>
                </div>
              ))}
            </div>
          ) : (
            <Card className="mt-4 divide-y divide-border-light">
              {filtered.map((tc) => (
                <TestCaseRowItem key={tc.id} tc={tc} />
              ))}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
