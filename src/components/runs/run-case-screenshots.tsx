"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { uploadAttachment, deleteAttachment } from "@/lib/actions/attachments";
import type { RunCaseAttachmentItem } from "@/components/runs/run-executor";

export function RunCaseScreenshots({
  projectId,
  testCaseId,
  runCaseId,
  attachments,
}: {
  projectId: string;
  testCaseId: string;
  runCaseId: string;
  attachments: RunCaseAttachmentItem[];
}) {
  const router = useRouter();
  const [isUploading, startUpload] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function uploadFile(file: File) {
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("runCaseId", runCaseId);
    startUpload(async () => {
      const result = await uploadAttachment(projectId, testCaseId, {}, formData);
      if (result.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  function handleDelete(attachmentId: string, storagePath: string) {
    setPendingDeleteIds((prev) => [...prev, attachmentId]);
    void deleteAttachment(projectId, testCaseId, attachmentId, storagePath).then(() => {
      router.refresh();
    });
  }

  const visible = attachments.filter((a) => !pendingDeleteIds.includes(a.id));

  return (
    <div>
      <div className="mb-1 text-xs font-ui-label font-semibold uppercase tracking-wide text-ink-tertiary">
        Screenshots
      </div>
      <div className="flex h-16 flex-wrap items-start gap-1.5">
        {visible.map((a) => (
          <div
            key={a.id}
            className="group relative h-9 w-9 shrink-0 overflow-hidden rounded-md border border-border-light"
          >
            {a.downloadUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.downloadUrl} alt={a.fileName} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-paper-muted text-ink-tertiary">
                <ImagePlus size={14} />
              </div>
            )}
            <button
              type="button"
              onClick={() => handleDelete(a.id, a.storagePath)}
              className="absolute inset-0 hidden items-center justify-center bg-black/50 text-white group-hover:flex"
              aria-label={`Remove ${a.fileName}`}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-dashed border-border-medium text-ink-tertiary hover:border-primary hover:text-primary disabled:opacity-60"
          aria-label="Add screenshot"
        >
          {isUploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            files.forEach(uploadFile);
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
        />
      </div>
      {error && <p className="mt-1 text-xs text-fail">{error}</p>}
    </div>
  );
}
