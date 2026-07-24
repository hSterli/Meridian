"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import { rateLimit } from "@/lib/rate-limit";
import type { RunCaseStatus } from "@/lib/types/database";
import type { ActionState } from "@/lib/actions/auth";

/** Get-or-create a project's run folder by name, returning its id. */
async function upsertRunFolder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  name: string
): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const { data: existing } = await supabase
    .from("run_folders")
    .select("id")
    .eq("project_id", projectId)
    .eq("name", trimmed)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created } = await supabase
    .from("run_folders")
    .insert({ project_id: projectId, name: trimmed })
    .select("id")
    .single();

  return created?.id ?? null;
}

export async function createRunFolder(
  projectId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Folder name is required." };

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("create_run_folder", 30, 3600);
  if (limitError) return { error: limitError };

  const supabase = await createClient();
  const folderId = await upsertRunFolder(supabase, projectId, name);
  if (!folderId) return { error: "Could not create folder." };

  revalidatePath(`/projects/${projectId}/runs`);
  return {};
}

export async function createRun(
  projectId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const testCaseIds = formData.getAll("testCaseIds").map(String);
  const folderChoice = String(formData.get("folder") ?? "");
  const newFolderName = String(formData.get("newFolder") ?? "").trim();

  if (!name) return { error: "Run name is required." };
  if (testCaseIds.length === 0) return { error: "Select at least one test case." };

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("create_run", 30, 3600);
  if (limitError) return { error: limitError };

  const supabase = await createClient();

  let folderId: string | null = null;
  if (folderChoice === "__new__") {
    if (newFolderName) folderId = await upsertRunFolder(supabase, projectId, newFolderName);
  } else if (folderChoice) {
    folderId = await upsertRunFolder(supabase, projectId, folderChoice);
  }

  const { data: run, error } = await supabase
    .from("test_runs")
    .insert({
      project_id: projectId,
      name,
      status: "planned",
      created_by: ctx.userId,
      folder_id: folderId,
    })
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

export async function addTestCasesToRun(
  projectId: string,
  runId: string,
  formData: FormData
) {
  const testCaseIds = formData.getAll("testCaseIds").map(String);
  const ctx = await getUserContext();
  if (!ctx || testCaseIds.length === 0) return;

  const limitError = await rateLimit("edit_run_membership", 60, 60);
  if (limitError) return;

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("test_run_cases")
    .select("test_case_id, order_index")
    .eq("run_id", runId);

  const existingIds = new Set((existing ?? []).map((r) => r.test_case_id));
  const toAdd = testCaseIds.filter((id) => !existingIds.has(id));
  if (toAdd.length === 0) return;

  const startIndex = (existing ?? []).reduce((max, r) => Math.max(max, r.order_index), -1) + 1;

  await supabase.from("test_run_cases").insert(
    toAdd.map((test_case_id, i) => ({
      run_id: runId,
      test_case_id,
      order_index: startIndex + i,
    }))
  );

  // A run marked completed is no longer "done" once new pending cases land in it.
  await supabase
    .from("test_runs")
    .update({ status: "in_progress", completed_at: null })
    .eq("id", runId)
    .eq("status", "completed");

  revalidatePath(`/projects/${projectId}/runs/${runId}`);
}

export async function bulkDeleteRuns(projectId: string, runIds: string[]) {
  const ctx = await getUserContext();
  if (!ctx || runIds.length === 0) return;

  const limitError = await rateLimit("bulk_run_action", 30, 60);
  if (limitError) return;

  const supabase = await createClient();
  await supabase.from("test_runs").delete().in("id", runIds);
  revalidatePath(`/projects/${projectId}/runs`);
}

export async function bulkMoveRunsToFolder(
  projectId: string,
  runIds: string[],
  folderId: string | null
) {
  const ctx = await getUserContext();
  if (!ctx || runIds.length === 0) return;

  const limitError = await rateLimit("bulk_run_action", 30, 60);
  if (limitError) return;

  const supabase = await createClient();
  await supabase.from("test_runs").update({ folder_id: folderId }).in("id", runIds);
  revalidatePath(`/projects/${projectId}/runs`);
}
