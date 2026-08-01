import { createClient } from "@/lib/supabase/server";
import type { TestStep } from "@/lib/types/database";

// Prefix values that a spreadsheet app would interpret as a formula (leading
// =, +, -, @) with an apostrophe — the standard CSV-injection mitigation.
// Excel/Sheets treat a leading apostrophe as "force text" and don't display
// it, so this is invisible for legitimate content and neutralizes the rest.
function csvEscape(value: string) {
  const withFormulaGuard = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n]/.test(withFormulaGuard)) {
    return `"${withFormulaGuard.replace(/"/g, '""')}"`;
  }
  return withFormulaGuard;
}

function encodeSteps(steps: TestStep[]) {
  return steps.map((s) => `${s.step}|${s.expected}`).join(";;");
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await context.params;
  const supabase = await createClient();

  const { data: customFieldDefs } = await supabase
    .from("test_case_custom_fields")
    .select("id, name")
    .eq("project_id", projectId)
    .order("display_order")
    .order("created_at");

  const { data: testCases } = await supabase
    .from("test_cases")
    .select(
      "title, preconditions, priority, status, steps, sprint_number, custom_fields, test_case_tag_links(test_case_tags(name)), test_case_features(name)"
    )
    .eq("project_id", projectId)
    .order("created_at");

  const customFieldColumns = customFieldDefs ?? [];
  const header = [
    "title",
    "preconditions",
    "priority",
    "status",
    "tags",
    "feature",
    "sprint",
    "steps",
    ...customFieldColumns.map((f) => f.name),
  ].join(",");
  const rows = (testCases ?? []).map((tc) => {
    const tags = (tc.test_case_tag_links ?? [])
      .map((l) => {
        const linked = l.test_case_tags as unknown as { name: string } | { name: string }[] | null;
        return Array.isArray(linked) ? linked[0]?.name : linked?.name;
      })
      .filter(Boolean)
      .join("|");
    const linkedFeature = tc.test_case_features as unknown as
      | { name: string }
      | { name: string }[]
      | null;
    const feature = Array.isArray(linkedFeature) ? linkedFeature[0]?.name : linkedFeature?.name;
    const customValues = customFieldColumns.map(
      (f) => (tc.custom_fields as Record<string, string> | null)?.[f.id] ?? ""
    );
    return [
      tc.title,
      tc.preconditions ?? "",
      tc.priority,
      tc.status,
      tags,
      feature ?? "",
      tc.sprint_number ?? "",
      encodeSteps((tc.steps as TestStep[]) ?? []),
      ...customValues,
    ]
      .map((v) => csvEscape(String(v)))
      .join(",");
  });

  const csv = [header, ...rows].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="test-cases-${projectId}.csv"`,
    },
  });
}
