"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useSearchParams, usePathname } from "next/navigation";
import { clsx } from "clsx";
import { Plus, Folder } from "lucide-react";
import { createRunFolder } from "@/lib/actions/runs";
import type { ActionState } from "@/lib/actions/auth";

export function RunFolderSidebar({
  projectId,
  folders,
}: {
  projectId: string;
  folders: { id: string; name: string }[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeFolder = searchParams.get("folder");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const action = createRunFolder.bind(null, projectId);
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(action, {});

  function hrefFor(folderId?: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (folderId) params.set("folder", folderId);
    else params.delete("folder");
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  return (
    <aside className="w-56 shrink-0 space-y-1">
      <p className="mb-2 px-2 text-[11px] font-ui-label font-bold uppercase tracking-widest text-ink-tertiary">
        Folders
      </p>
      <Link
        href={hrefFor()}
        className={clsx(
          "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-ui-label font-semibold transition-colors",
          !activeFolder ? "bg-meridian-soft text-meridian-dark" : "text-ink-secondary hover:bg-paper-muted"
        )}
      >
        All Runs
      </Link>
      {folders.map((f) => (
        <Link
          key={f.id}
          href={hrefFor(f.id)}
          className={clsx(
            "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
            activeFolder === f.id
              ? "bg-meridian-soft font-semibold text-meridian-dark"
              : "text-ink-secondary hover:bg-paper-muted"
          )}
        >
          <Folder size={14} className="shrink-0" />
          <span className="truncate">{f.name}</span>
        </Link>
      ))}

      {showNewFolder ? (
        <form
          action={(formData) => {
            formAction(formData);
            setShowNewFolder(false);
          }}
          className="px-2 pt-1"
        >
          <input
            name="name"
            autoFocus
            placeholder="Folder name"
            className="w-full rounded-md border border-border-medium px-2 py-1 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Escape") setShowNewFolder(false);
            }}
          />
          {state.error && <p className="mt-1 text-xs text-fail">{state.error}</p>}
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowNewFolder(true)}
          disabled={isPending}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink-tertiary transition-colors hover:bg-paper-muted hover:text-ink-primary"
        >
          <Plus size={14} />
          New folder
        </button>
      )}
    </aside>
  );
}
