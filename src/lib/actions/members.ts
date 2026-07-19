"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import type { OrgRole } from "@/lib/types/database";
import type { ActionState } from "@/lib/actions/auth";

export async function inviteMember(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = (String(formData.get("role") ?? "member") as OrgRole) || "member";

  if (!email) return { error: "Email is required." };

  const ctx = await getUserContext();
  if (!ctx || !ctx.activeOrgId) return { error: "No active team selected." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("organization_invites")
    .insert({ org_id: ctx.activeOrgId, email, role, invited_by: ctx.userId });

  if (error) return { error: error.message };

  revalidatePath("/settings/members");
  return {};
}

export async function cancelInvite(inviteId: string) {
  const supabase = await createClient();
  await supabase.from("organization_invites").delete().eq("id", inviteId);
  revalidatePath("/settings/members");
}

export async function updateMemberRole(orgId: string, userId: string, role: OrgRole) {
  const supabase = await createClient();
  await supabase
    .from("organization_members")
    .update({ role })
    .eq("org_id", orgId)
    .eq("user_id", userId);
  revalidatePath("/settings/members");
}

export async function removeMember(orgId: string, userId: string) {
  const supabase = await createClient();
  await supabase.from("organization_members").delete().eq("org_id", orgId).eq("user_id", userId);
  revalidatePath("/settings/members");
}

/** Joins the current user to any org that has a pending invite matching their email. */
export async function acceptPendingInvites() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return;

  const { data: invites } = await supabase
    .from("organization_invites")
    .select("id, org_id, role")
    .ilike("email", user.email);

  for (const invite of invites ?? []) {
    await supabase
      .from("organization_members")
      .insert({ org_id: invite.org_id, user_id: user.id, role: invite.role });
    await supabase.from("organization_invites").delete().eq("id", invite.id);
  }
}
