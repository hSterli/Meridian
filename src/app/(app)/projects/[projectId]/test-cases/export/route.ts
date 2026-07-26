import { createClient } from "@/lib/supabase/server";
import type { TestStep } from "@/lib/types/database";

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
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

  const { data: testCases } = await supabase
    .from("test_cases")
    .select(
      "title, preconditions, priority, status, steps, sprint_number, test_case_tag_links(test_case_tags(name)), test_case_features(name)"
    )
    .eq("project_id", projectId)
    .order("created_at");

  const header = "title,preconditions,priority,status,tags,feature,sprint,steps";
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
    return [
      tc.title,
      tc.preconditions ?? "",
      tc.priority,
      tc.status,
      tags,
      feature ?? "",
      tc.sprint_number ?? "",
      encodeSteps((tc.steps as TestStep[]) ?? []),
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
