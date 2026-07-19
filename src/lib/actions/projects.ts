"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import type { ProjectTemplate } from "@/lib/types/database";
import type { ActionState } from "@/lib/actions/auth";

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 10)
    .toUpperCase();
}

export async function createProject(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const template = (String(formData.get("template") ?? "blank") as ProjectTemplate) || "blank";

  if (!name) return { error: "Project name is required." };

  const ctx = await getUserContext();
  if (!ctx || !ctx.activeOrgId) return { error: "No active team selected." };

  const supabase = await createClient();
  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      org_id: ctx.activeOrgId,
      name,
      key: slugify(name) || "PROJ",
      template,
      created_by: ctx.userId,
    })
    .select()
    .single();

  if (error || !project) {
    return { error: error?.message ?? "Could not create project." };
  }

  redirect(`/projects/${project.id}/test-cases`);
}
