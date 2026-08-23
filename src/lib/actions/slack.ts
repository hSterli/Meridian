"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import { rateLimit } from "@/lib/rate-limit";
import { verifySlackBotAccess } from "@/lib/slack/client";
import type { ActionState } from "@/lib/actions/auth";

export async function connectSlackNotifications(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const projectId = String(formData.get("projectId") ?? "").trim();
  const channelId = String(formData.get("channelId") ?? "").trim();
  const botToken = String(formData.get("botToken") ?? "").trim();

  if (!projectId || !channelId || !botToken) {
    return { error: "All fields are required." };
  }

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.activeRole !== "owner" && ctx.activeRole !== "admin") {
    return { error: "Only owners and admins can connect Slack notifications." };
  }

  const limitError = await rateLimit("connect_slack", 10, 3600);
  if (limitError) return { error: limitError };

  const access = await verifySlackBotAccess(botToken, channelId);
  if ("error" in access) return { error: access.error };

  const supabase = await createClient();

  const { data: connectionId, error } = await supabase.rpc("create_slack_connection", {
    p_project_id: projectId,
    p_channel_id: channelId,
    p_bot_token: botToken,
  });

  if (error || !connectionId) return { error: error?.message ?? "Could not save connection." };

  revalidatePath("/settings/integrations/slack");
  return {};
}

export async function disconnectSlackNotifications(connectionId: string) {
  const supabase = await createClient();
  await supabase.rpc("delete_slack_connection", { p_connection_id: connectionId });
  revalidatePath("/settings/integrations/slack");
}
