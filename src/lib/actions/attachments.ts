"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import { rateLimit } from "@/lib/rate-limit";
import type { ActionState } from "@/lib/actions/auth";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const BUCKET = "test-case-attachments";

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
}

export async function uploadAttachment(
  projectId: string,
  testCaseId: string,
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { error: "File is too large — max 10 MB." };
  }

  const ctx = await getUserContext();
  if (!ctx) return { error: "Not authenticated." };

  const limitError = await rateLimit("upload_attachment", 30, 3600);
  if (limitError) return { error: limitError };

  const supabase = await createClient();

  const storagePath = `${projectId}/${testCaseId}/${crypto.randomUUID()}-${sanitizeFileName(
    file.name
  )}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: file.type || undefined });

  if (uploadError) return { error: uploadError.message };

  const { error: insertError } = await supabase.from("test_case_attachments").insert({
    test_case_id: testCaseId,
    storage_path: storagePath,
    file_name: file.name,
    file_size: file.size,
    uploaded_by: ctx.userId,
  });

  if (insertError) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return { error: insertError.message };
  }

  revalidatePath(`/projects/${projectId}/test-cases/${testCaseId}`);
  return {};
}

export async function deleteAttachment(
  projectId: string,
  testCaseId: string,
  attachmentId: string,
  storagePath: string
) {
  const ctx = await getUserContext();
  if (!ctx) return;

  const supabase = await createClient();
  await supabase.from("test_case_attachments").delete().eq("id", attachmentId);
  await supabase.storage.from(BUCKET).remove([storagePath]);

  revalidatePath(`/projects/${projectId}/test-cases/${testCaseId}`);
}

export async function getAttachmentDownloadUrl(storagePath: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 60);
  if (error) return null;
  return data.signedUrl;
}
