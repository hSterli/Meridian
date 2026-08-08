"use client";

import { useActionState, useRef } from "react";
import { Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ActionState } from "@/lib/actions/auth";

export interface AttachmentRow {
  id: string;
  storagePath: string;
  fileName: string;
  fileSize: number | null;
  uploadedAt: string;
  downloadUrl: string | null;
  runName: string | null;
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentsPanel({
  attachments,
  uploadAction,
  deleteAction,
}: {
  attachments: AttachmentRow[];
  uploadAction: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  deleteAction: (attachmentId: string, storagePath: string) => void;
}) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(uploadAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-ink-secondary">Attachments</h2>
      <Card className="divide-y divide-border-light">
        {attachments.length === 0 ? (
          <div className="px-3 py-2 text-sm text-ink-tertiary">No attachments yet.</div>
        ) : (
          attachments.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <a
                href={a.downloadUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 items-center gap-1.5 text-ink-primary hover:text-primary"
              >
                <Paperclip size={14} className="shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate">{a.fileName}</span>
                  {a.runName && (
                    <span className="block text-[10px] font-normal uppercase tracking-wide text-ink-tertiary">
                      from Run: {a.runName}
                    </span>
                  )}
                </span>
              </a>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-ink-tertiary">{formatSize(a.fileSize)}</span>
                <button
                  type="button"
                  onClick={() => deleteAction(a.id, a.storagePath)}
                  className="text-ink-tertiary hover:text-fail"
                  aria-label={`Remove ${a.fileName}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </Card>

      <form
        ref={formRef}
        action={async (formData) => {
          await formAction(formData);
          formRef.current?.reset();
        }}
        className="mt-2 flex items-center gap-2"
      >
        <input
          type="file"
          name="file"
          required
          className="block flex-1 text-xs text-ink-secondary file:mr-2 file:rounded-md file:border-0 file:bg-paper-surface file:px-2 file:py-1 file:text-xs file:font-medium file:text-ink-primary"
        />
        <Button type="submit" variant="secondary" disabled={isPending}>
          {isPending ? "Uploading…" : "Upload"}
        </Button>
      </form>
      {state.error && <p className="mt-1 text-xs text-fail">{state.error}</p>}
    </div>
  );
}
