"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import { rateLimit } from "@/lib/rate-limit";
import type { RunCaseStatus } from "@/lib/types/database";
import type { ActionState } from "@/lib/actions/auth";

export async function createRun(
  projectId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const testCaseIds = formData.getAll("testCaseIds").map(String);

  if (!name) return { error: "Run name is required." };
  if (testCaseIds.length === 0) return { error: "Select at least one test case." };

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("create_run", 30, 3600);
  if (limitError) return { error: limitError };

  const supabase = await createClient();

  const { data: run, error } = await supabase
    .from("test_runs")
    .insert({ project_id: projectId, name, status: "planned", created_by: ctx.userId })
    .select()
    .single();

  if (error || !run) return { error: error?.message ?? "Could not create run." };

  const { error: casesError } = await supabase.from("test_run_cases").insert(
    testCaseIds.map((test_case_id, index) => ({
      run_id: run.id,
      test_case_id,
      order_index: index,
    }))
  );

  if (casesError) return { error: casesError.message };

  redirect(`/projects/${projectId}/runs/${run.id}`);
}

export async function setRunCaseStatus(
  projectId: string,
  runId: string,
  runCaseId: string,
  status: RunCaseStatus,
  notes: string
) {
  const ctx = await getUserContext();
  if (!ctx) return;

  const limitError = await rateLimit("set_run_case_status", 300, 300);
  if (limitError) return;

  const supabase = await createClient();

  await supabase
    .from("test_run_cases")
    .update({
      status,
      notes: notes || null,
      executed_by: ctx.userId,
      executed_at: new Date().toISOString(),
    })
    .eq("id", runCaseId);

  await supabase
    .from("test_runs")
    .update({ status: "in_progress" })
    .eq("id", runId)
    .eq("status", "planned");

  const { data: remaining } = await supabase
    .from("test_run_cases")
    .select("id")
    .eq("run_id", runId)
    .eq("status", "pending");

  if (remaining && remaining.length === 0) {
    await supabase
      .from("test_runs")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", runId);
  }

  revalidatePath(`/projects/${projectId}/runs/${runId}`);
}

export async function deleteRun(projectId: string, runId: string) {
  const supabase = await createClient();
  await supabase.from("test_runs").delete().eq("id", runId);
  revalidatePath(`/projects/${projectId}/runs`);
  redirect(`/projects/${projectId}/runs`);
}
