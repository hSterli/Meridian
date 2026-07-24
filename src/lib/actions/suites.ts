"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import { rateLimit } from "@/lib/rate-limit";
import type { ActionState } from "@/lib/actions/auth";

export async function createSuite(
  projectId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const testCaseIds = formData.getAll("testCaseIds").map(String);

  if (!name) return { error: "Suite name is required." };

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("create_suite", 30, 3600);
  if (limitError) return { error: limitError };

  const supabase = await createClient();

  const { data: suite, error } = await supabase
    .from("test_suites")
    .insert({ project_id: projectId, name, created_by: ctx.userId })
    .select()
    .single();

  if (error || !suite) return { error: error?.message ?? "Could not create suite." };

  if (testCaseIds.length > 0) {
    await supabase
      .from("test_suite_cases")
      .insert(testCaseIds.map((test_case_id) => ({ suite_id: suite.id, test_case_id })));
  }

  redirect(`/projects/${projectId}/suites/${suite.id}`);
}

export async function addTestCasesToSuite(
  projectId: string,
  suiteId: string,
  formData: FormData
) {
  const testCaseIds = formData.getAll("testCaseIds").map(String);
  const ctx = await getUserContext();
  if (!ctx || testCaseIds.length === 0) return;

  const limitError = await rateLimit("edit_suite_membership", 60, 60);
  if (limitError) return;

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("test_suite_cases")
    .select("test_case_id")
    .eq("suite_id", suiteId);

  const existingIds = new Set((existing ?? []).map((r) => r.test_case_id));
  const toAdd = testCaseIds.filter((id) => !existingIds.has(id));

  if (toAdd.length > 0) {
    await supabase
      .from("test_suite_cases")
      .insert(toAdd.map((test_case_id) => ({ suite_id: suiteId, test_case_id })));
  }

  revalidatePath(`/projects/${projectId}/suites/${suiteId}`);
}

export async function removeTestCaseFromSuite(
  projectId: string,
  suiteId: string,
  testCaseId: string
) {
  const ctx = await getUserContext();
  if (!ctx) return;

  const limitError = await rateLimit("edit_suite_membership", 60, 60);
  if (limitError) return;

  const supabase = await createClient();
  await supabase
    .from("test_suite_cases")
    .delete()
    .eq("suite_id", suiteId)
    .eq("test_case_id", testCaseId);

  revalidatePath(`/projects/${projectId}/suites/${suiteId}`);
}

/** Snapshots a suite's current membership into a brand-new run, so past
 * results never shift even if the suite's membership changes later. */
export async function runSuiteNow(projectId: string, suiteId: string) {
  const ctx = await getUserContext();
  if (!ctx) return;

  const limitError = await rateLimit("create_run", 30, 3600);
  if (limitError) return;

  const supabase = await createClient();

  const { data: suite } = await supabase
    .from("test_suites")
    .select("name")
    .eq("id", suiteId)
    .single();
  if (!suite) return;

  const { data: members } = await supabase
    .from("test_suite_cases")
    .select("test_case_id")
    .eq("suite_id", suiteId);

  if (!members || members.length === 0) return;

  const runName = `${suite.name} — ${new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;

  const { data: run, error } = await supabase
    .from("test_runs")
    .insert({
      project_id: projectId,
      name: runName,
      status: "planned",
      created_by: ctx.userId,
      suite_id: suiteId,
    })
    .select()
    .single();

  if (error || !run) return;

  await supabase.from("test_run_cases").insert(
    members.map((m, index) => ({
      run_id: run.id,
      test_case_id: m.test_case_id,
      order_index: index,
    }))
  );

  redirect(`/projects/${projectId}/runs/${run.id}`);
}

export async function deleteSuite(projectId: string, suiteId: string) {
  const supabase = await createClient();
  await supabase.from("test_suites").delete().eq("id", suiteId);
  revalidatePath(`/projects/${projectId}/suites`);
  redirect(`/projects/${projectId}/suites`);
}
