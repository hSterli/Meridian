"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import { rateLimit } from "@/lib/rate-limit";
import type { ActionState } from "@/lib/actions/auth";
import type { ReportRagStatus } from "@/lib/types/database";

export async function updateWeeklyReportDraft(
  projectId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("update_weekly_report_draft", 60, 3600);
  if (limitError) return { error: limitError };

  const ragStatusRaw = formData.get("ragStatus");
  const highlights = formData.get("highlights");
  if (ragStatusRaw !== "red" && ragStatusRaw !== "amber" && ragStatusRaw !== "green") {
    return { error: "Choose a valid RAG status." };
  }
  // ragStatusRaw is `FormDataEntryValue | null` (string | File | null), which
  // TypeScript can't narrow via the negative `!==` checks above (that only
  // works for a variable already typed as a union of literals, not a plain
  // `string`). Re-check positively so `ragStatus` is genuinely narrowed to
  // ReportRagStatus below, instead of casting.
  const ragStatus: ReportRagStatus =
    ragStatusRaw === "red" ? "red" : ragStatusRaw === "amber" ? "amber" : "green";

  const supabase = await createClient();
  const { error } = await supabase.from("weekly_report_drafts").upsert({
    project_id: projectId,
    rag_status: ragStatus,
    highlights: typeof highlights === "string" ? highlights : "",
    updated_by: ctx.userId,
    updated_at: new Date().toISOString(),
  });

  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}/reports`);
  return {};
}

export async function updateDailyPlan(
  projectId: string,
  planDate: string,
  plannedCount: number
): Promise<void> {
  const ctx = await getUserContext();
  if (!ctx) return;

  const limitError = await rateLimit("update_daily_plan", 120, 3600);
  if (limitError) return;

  const supabase = await createClient();
  await supabase.from("weekly_report_daily_plans").upsert({
    project_id: projectId,
    plan_date: planDate,
    planned_count: Number.isFinite(plannedCount) && plannedCount >= 0 ? Math.floor(plannedCount) : 0,
    updated_by: ctx.userId,
    updated_at: new Date().toISOString(),
  });

  revalidatePath(`/projects/${projectId}/reports`);
}
