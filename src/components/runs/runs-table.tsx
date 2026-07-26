"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Badge } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { bulkDeleteRuns, bulkMoveRunsToFolder } from "@/lib/actions/runs";
import type { RunStatus } from "@/lib/types/database";

export interface RunRow {
  id: string;
  displayId: number;
  name: string;
  status: RunStatus;
  instances: number;
  updatedAt: string;
  folderId: string | null;
  segments: { passed: number; failed: number; blocked: number; skipped: number; pending: number };
}

const STATUS_TONE: Record<RunStatus, "slate" | "amber" | "green"> = {
  planned: "slate",
  in_progress: "amber",
  completed: "green",
};

const SORT_COLUMNS: { key: string; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "status", label: "Run Status" },
];

const SORT_COLUMNS_AFTER_PROGRESS: { key: string; label: string }[] = [
  { key: "instances", label: "Instances" },
  { key: "updated", label: "Last Updated" },
];

export function RunsTable({
  projectId,
  folders,
  rows,
}: {
  projectId: string;
  folders: { id: string; name: string }[];
  rows: RunRow[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const sort = searchParams.get("sort") ?? "updated";
  const dir = searchParams.get("dir") === "asc" ? "asc" : "desc";

  function sortHref(key: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", key);
    params.set("dir", sort === key && dir === "desc" ? "asc" : "desc");
    return `${pathname}?${params.toString()}`;
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }

  function handleDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} run(s)? This can't be undone.`)) return;
    const ids = Array.from(selected);
    startTransition(async () => {
      await bulkDeleteRuns(projectId, ids);
      setSelected(new Set());
      router.refresh();
    });
  }

  function handleMove(folderId: string) {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    startTransition(async () => {
      await bulkMoveRunsToFolder(projectId, ids, folderId || null);
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div>
      {selected.size > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-border-light bg-meridian-soft px-4 py-2">
          <span className="text-sm font-ui-label font-semibold text-meridian-dark">
            {selected.size} selected
          </span>
          <Select
            defaultValue=""
            disabled={isPending}
            onChange={(e) => handleMove(e.target.value)}
            className="text-ink-secondary"
          >
            <option value="" disabled>
              Move to folder…
            </option>
            <option value="">No folder</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
          <button
            type="button"
            disabled={isPending}
            onClick={handleDelete}
            className="rounded-lg border border-fail/20 bg-fail-soft px-3 py-1 text-sm font-ui-label font-semibold text-fail hover:bg-fail-soft/80"
          >
            Delete
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border-light bg-white shadow-sm">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border-light bg-paper-muted text-[11px] uppercase tracking-wider text-ink-tertiary">
              <th className="w-10 p-3">
                <input
                  type="checkbox"
                  checked={selected.size === rows.length && rows.length > 0}
                  onChange={toggleAll}
                  className="rounded border-border-medium"
                />
              </th>
              <th className="p-3 font-ui-label">ID</th>
              {SORT_COLUMNS.map((col) => (
                <th key={col.key} className="p-3 font-ui-label">
                  <Link href={sortHref(col.key)} className="inline-flex items-center gap-1 hover:text-ink-primary">
                    {col.label}
                    {sort === col.key && <span>{dir === "asc" ? "↑" : "↓"}</span>}
                  </Link>
                </th>
              ))}
              <th className="p-3 font-ui-label">Run Status Bar</th>
              {SORT_COLUMNS_AFTER_PROGRESS.map((col) => (
                <th key={col.key} className="p-3 font-ui-label">
                  <Link href={sortHref(col.key)} className="inline-flex items-center gap-1 hover:text-ink-primary">
                    {col.label}
                    {sort === col.key && <span>{dir === "asc" ? "↑" : "↓"}</span>}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {rows.map((row) => {
              const total = row.instances || 1;
              return (
                <tr key={row.id} className="transition-colors hover:bg-paper-surface">
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggle(row.id)}
                      className="rounded border-border-medium"
                    />
                  </td>
                  <td className="p-3 font-mono-data text-xs text-ink-tertiary">R-{row.displayId}</td>
                  <td className="p-3">
                    <Link
                      href={`/projects/${projectId}/runs/${row.id}`}
                      className="font-ui-label font-semibold text-ink-primary hover:text-primary"
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td className="p-3">
                    <Badge tone={STATUS_TONE[row.status]}>{row.status.replace("_", " ")}</Badge>
                  </td>
                  <td className="p-3">
                    <div className="flex h-2 w-40 overflow-hidden rounded-full bg-surface-container-highest">
                      <div className="h-full bg-pass" style={{ width: `${(row.segments.passed / total) * 100}%` }} />
                      <div className="h-full bg-fail" style={{ width: `${(row.segments.failed / total) * 100}%` }} />
                      <div
                        className="h-full bg-blocked"
                        style={{ width: `${(row.segments.blocked / total) * 100}%` }}
                      />
                      <div
                        className="h-full bg-ink-tertiary"
                        style={{ width: `${(row.segments.skipped / total) * 100}%` }}
                      />
                    </div>
                  </td>
                  <td className="p-3 font-mono-data text-sm text-ink-primary">{row.instances}</td>
                  <td className="p-3 text-sm text-ink-tertiary">
                    {new Date(row.updatedAt).toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
