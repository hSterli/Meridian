"use server";

import { randomBytes, createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import { rateLimit } from "@/lib/rate-limit";

export interface ApiKeyActionState {
  error?: string;
  plaintextKey?: string;
}

function generateApiKey(): { plaintext: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  const plaintext = `mk_live_${raw}`;
  const hash = createHash("sha256").update(plaintext).digest("hex");
  return { plaintext, hash };
}

export async function createApiKey(
  orgId: string,
  _prevState: ApiKeyActionState,
  formData: FormData
): Promise<ApiKeyActionState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Key name is required." };

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };
  if (ctx.activeRole !== "owner" && ctx.activeRole !== "admin") {
    return { error: "Only owners and admins can create API keys." };
  }

  const limitError = await rateLimit("create_api_key", 10, 3600);
  if (limitError) return { error: limitError };

  const { plaintext, hash } = generateApiKey();
  const supabase = await createClient();

  const { error } = await supabase.from("api_keys").insert({
    org_id: orgId,
    name,
    key_hash: hash,
    created_by: ctx.userId,
  });

  if (error) return { error: error.message };

  revalidatePath("/settings/api");
  return { plaintextKey: plaintext };
}

export async function revokeApiKey(orgId: string, keyId: string) {
  const supabase = await createClient();
  await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId);
  revalidatePath("/settings/api");
}
