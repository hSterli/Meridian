"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { clsx } from "clsx";
import { CheckCircle2, XCircle, MinusCircle, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { setRunCaseStatus } from "@/lib/actions/runs";
import type { RunCaseStatus, TestStep } from "@/lib/types/database";

export interface RunCaseItem {
  id: string;
  status: RunCaseStatus;
  notes: string | null;
  test_case: {
    id: string;
    title: string;
    preconditions: string | null;
    steps: TestStep[];
  };
}

const STATUS_CONFIG: Record<
  Exclude<RunCaseStatus, "pending">,
  { label: string; icon: typeof CheckCircle2; className: string; key: string }
> = {
  passed: { label: "Pass", icon: CheckCircle2, className: "bg-emerald-600 hover:bg-emerald-500", key: "P" },
  failed: { label: "Fail", icon: XCircle, className: "bg-red-600 hover:bg-red-500", key: "F" },
  blocked: { label: "Blocked", icon: MinusCircle, className: "bg-amber-500 hover:bg-amber-400", key: "B" },
  skipped: { label: "Skip", icon: SkipForward, className: "bg-slate-400 hover:bg-slate-300", key: "S" },
};

export function RunExecutor({
  projectId,
  runId,
  cases,
}: {
  projectId: string;
  runId: string;
  cases: RunCaseItem[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(cases);
  const [index, setIndex] = useState(() => {
    const firstPending = cases.findIndex((c) => c.status === "pending");
    return firstPending === -1 ? 0 : firstPending;
  });
  const [isPending, startTransition] = useTransition();
  const notesRef = useRef<HTMLTextAreaElement>(null);

  const current = items[index];
  const passedCount = items.filter((i) => i.status === "passed").length;
  const failedCount = items.filter((i) => i.status === "failed").length;
  const doneCount = items.filter((i) => i.status !== "pending").length;

  function applyStatus(status: RunCaseStatus) {
    if (!current) return;
    const noteValue = notesRef.current?.value ?? "";
    setItems((prev) =>
      prev.map((c) => (c.id === current.id ? { ...c, status, notes: noteValue } : c))
    );
    startTransition(async () => {
      await setRunCaseStatus(projectId, runId, current.id, status, noteValue);
      router.refresh();
    });

    const nextPending = items.findIndex((c, i) => i > index && c.status === "pending");
    if (nextPending !== -1) {
      setIndex(nextPending);
    } else if (index < items.length - 1) {
      setIndex(index + 1);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (document.activeElement === notesRef.current) return;
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, items.length - 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
      if (e.key.toLowerCase() === "p") applyStatus("passed");
      if (e.key.toLowerCase() === "f") applyStatus("failed");
      if (e.key.toLowerCase() === "b") applyStatus("blocked");
      if (e.key.toLowerCase() === "s") applyStatus("skipped");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, items]);

  if (!current) return null;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
      <div>
        <div className="mb-2 text-xs text-slate-500">
          {doneCount}/{items.length} executed · {passedCount} passed · {failedCount} failed
        </div>
        <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full bg-indigo-600 transition-all"
            style={{ width: `${(doneCount / items.length) * 100}%` }}
          />
        </div>
        <div className="max-h-[60vh] space-y-1 overflow-y-auto">
          {items.map((c, i) => (
            <button
              key={c.id}
              onClick={() => setIndex(i)}
              className={clsx(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                i === index ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50"
              )}
            >
              <StatusDot status={c.status} />
              <span className="truncate">{c.test_case.title}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">{current.test_case.title}</h2>
            <StatusBadge status={current.status} />
          </div>
          <Link
            href={`/projects/${projectId}/issues/new?testCaseId=${current.test_case.id}&runCaseId=${current.id}`}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
          >
            Report issue
          </Link>
        </div>

        {current.test_case.preconditions && (
          <p className="mb-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <span className="font-medium">Preconditions:</span> {current.test_case.preconditions}
          </p>
        )}

        <ol className="mb-4 space-y-2">
          {current.test_case.steps.map((s, i) => (
            <li key={i} className="rounded-md border border-slate-200 p-3 text-sm">
              <div className="text-slate-800">
                <span className="font-medium text-slate-400">{i + 1}.</span> {s.step}
              </div>
              {s.expected && <div className="mt-1 text-slate-500">Expected: {s.expected}</div>}
            </li>
          ))}
          {current.test_case.steps.length === 0 && (
            <li className="text-sm text-slate-400">No steps recorded for this test case.</li>
          )}
        </ol>

        <textarea
          ref={notesRef}
          key={current.id}
          defaultValue={current.notes ?? ""}
          placeholder="Notes (optional)…"
          rows={2}
          className="mb-4 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />

        <div className="flex gap-2">
          {(Object.keys(STATUS_CONFIG) as (keyof typeof STATUS_CONFIG)[]).map((status) => {
            const cfg = STATUS_CONFIG[status];
            const Icon = cfg.icon;
            return (
              <Button
                key={status}
                type="button"
                disabled={isPending}
                onClick={() => applyStatus(status)}
                className={cfg.className}
              >
                <Icon size={16} /> {cfg.label}{" "}
                <kbd className="ml-1 rounded bg-black/20 px-1 text-[10px]">{cfg.key}</kbd>
              </Button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Shortcuts: P pass · F fail · B blocked · S skip · ← → navigate
        </p>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: RunCaseStatus }) {
  const colors: Record<RunCaseStatus, string> = {
    pending: "bg-slate-300",
    passed: "bg-emerald-500",
    failed: "bg-red-500",
    blocked: "bg-amber-500",
    skipped: "bg-slate-400",
  };
  return <span className={clsx("h-2 w-2 shrink-0 rounded-full", colors[status])} />;
}

function StatusBadge({ status }: { status: RunCaseStatus }) {
  if (status === "pending") return null;
  const tone = status === "passed" ? "green" : status === "failed" ? "red" : "amber";
  return <Badge tone={tone}>{status}</Badge>;
}
