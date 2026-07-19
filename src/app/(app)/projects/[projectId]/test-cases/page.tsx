import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { TestCaseFilters } from "@/components/test-cases/test-case-filters";
import { ImportCsvForm } from "@/components/test-cases/import-csv-form";
import type { TestCasePriority, TestCaseStatus } from "@/lib/types/database";

const PRIORITY_TONE: Record<TestCasePriority, "slate" | "amber" | "red" | "indigo"> = {
  low: "slate",
  medium: "indigo",
  high: "amber",
  critical: "red",
};

export default async function TestCasesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ q?: string; priority?: string; status?: string; tag?: string }>;
}) {
  const { projectId } = await params;
  const { q, priority, status, tag } = await searchParams;

  const supabase = await createClient();

  let query = supabase
    .from("test_cases")
    .select("id, title, priority, status, updated_at, test_case_tag_links(tag_id, test_case_tags(id, name, color))")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false });

  if (q) query = query.ilike("title", `%${q}%`);
  if (priority) query = query.eq("priority", priority as TestCasePriority);
  if (status) query = query.eq("status", status as TestCaseStatus);

  const { data: testCases } = await query;

  const { data: tags } = await supabase
    .from("test_case_tags")
    .select("id, name")
    .eq("project_id", projectId)
    .order("name");

  function tagName(l: { test_case_tags: { name: string } | { name: string }[] | null }) {
    return Array.isArray(l.test_case_tags) ? l.test_case_tags[0]?.name : l.test_case_tags?.name;
  }

  const filtered = tag
    ? (testCases ?? []).filter((tc) => tc.test_case_tag_links?.some((l) => tagName(l) === tag))
    : testCases ?? [];

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

      <div className="mb-4 flex items-center justify-between">
        <TestCaseFilters tags={(tags ?? []).map((t) => t.name)} />
        <ImportCsvForm projectId={projectId} />
      </div>

      {filtered.length === 0 ? (
        <Card className="mt-4 p-8 text-center text-sm text-slate-500">
          No test cases match. {q || priority || status || tag ? "Try clearing filters." : ""}
        </Card>
      ) : (
        <Card className="mt-4 divide-y divide-slate-100">
          {filtered.map((tc) => (
            <Link
              key={tc.id}
              href={`/projects/${projectId}/test-cases/${tc.id}`}
              className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-50"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-slate-900">{tc.title}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {tc.test_case_tag_links?.map((l) =>
                    tagName(l) ? (
                      <Badge key={l.tag_id} tone="slate">
                        {tagName(l)}
                      </Badge>
                    ) : null
                  )}
                </div>
              </div>
              <Badge tone={PRIORITY_TONE[tc.priority as TestCasePriority]}>{tc.priority}</Badge>
              <Badge tone={tc.status === "active" ? "green" : "slate"}>{tc.status}</Badge>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
