"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { clsx } from "clsx";
import { CheckCircle2, XCircle, MinusCircle, SkipForward } from "lucide-react";
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
    feature: string | null;
  };
}

const STATUS_CONFIG: Record<
  Exclude<RunCaseStatus, "pending">,
  { label: string; icon: typeof CheckCircle2; className: string; key: string }
> = {
  passed: {
    label: "Pass Case",
    icon: CheckCircle2,
    className: "bg-meridian-dark text-white hover:shadow-lg",
    key: "ENTER",
  },
  failed: {
    label: "Fail",
    icon: XCircle,
    className: "border border-fail/20 bg-fail-soft text-fail hover:bg-fail-soft/80",
    key: "F",
  },
  blocked: {
    label: "Blocked",
    icon: MinusCircle,
    className: "border border-blocked/20 bg-blocked-soft text-blocked hover:bg-blocked-soft/80",
    key: "B",
  },
  skipped: {
    label: "Skip",
    icon: SkipForward,
    className: "border border-border-medium bg-white text-ink-secondary hover:bg-paper-muted",
    key: "S",
  },
};

const ORDER: (keyof typeof STATUS_CONFIG)[] = ["skipped", "blocked", "failed", "passed"];

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
      if (e.key === "Enter") applyStatus("passed");
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
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
      <div>
        <div className="mb-2 font-ui-label text-xs text-ink-secondary">
          {doneCount}/{items.length} executed · {passedCount} passed · {failedCount} failed
        </div>
        <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${(doneCount / items.length) * 100}%` }}
          />
        </div>
        <div className="max-h-[65vh] space-y-2 overflow-y-auto pr-1">
          {items.map((c, i) => (
            <button
              key={c.id}
              onClick={() => setIndex(i)}
              className={clsx(
                "flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm transition-all",
                i === index
                  ? "translate-x-1 border-2 border-meridian-dark bg-meridian-soft shadow-md"
                  : "border-border-light bg-white hover:border-primary/40"
              )}
            >
              <StatusDot status={c.status} />
              <span className="min-w-0 flex-1 truncate text-ink-primary">{c.test_case.title}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        {current.test_case.feature && (
          <Badge tone="blue" className="mb-2 uppercase tracking-wide">
            {current.test_case.feature}
          </Badge>
        )}
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="font-headline-sm text-lg font-semibold text-ink-primary">
              {current.test_case.title}
            </h2>
            <StatusBadge status={current.status} />
          </div>
          <Link
            href={`/projects/${projectId}/issues/new?testCaseId=${current.test_case.id}&runCaseId=${current.id}`}
            className="text-xs font-ui-label font-semibold text-primary hover:text-meridian-dark"
          >
            Report issue
          </Link>
        </div>

        {current.test_case.preconditions && (
          <p className="mb-4 rounded-lg bg-paper-muted px-3 py-2 text-sm text-ink-secondary">
            <span className="font-semibold text-ink-primary">Preconditions:</span>{" "}
            {current.test_case.preconditions}
          </p>
        )}

        <ol className="mb-4 space-y-2">
          {current.test_case.steps.map((s, i) => (
            <li
              key={i}
              className="rounded-xl border border-border-light bg-paper-surface/30 p-4 text-sm transition-colors hover:bg-paper-surface"
            >
              <div className="text-ink-primary">
                <span className="font-bold text-ink-tertiary">{i + 1}.</span> {s.step}
              </div>
              {s.expected && (
                <div className="mt-1 italic text-ink-secondary">Expected: {s.expected}</div>
              )}
            </li>
          ))}
          {current.test_case.steps.length === 0 && (
            <li className="text-sm text-ink-tertiary">No steps recorded for this test case.</li>
          )}
        </ol>

        <textarea
          ref={notesRef}
          key={current.id}
          defaultValue={current.notes ?? ""}
          placeholder="Add observations or failure details here…"
          rows={2}
          className="mb-4 block w-full rounded-xl border border-border-light bg-paper-muted/50 px-4 py-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
        />

        <div className="flex gap-3">
          {ORDER.map((status) => {
            const cfg = STATUS_CONFIG[status];
            const Icon = cfg.icon;
            return (
              <button
                key={status}
                type="button"
                disabled={isPending}
                onClick={() => applyStatus(status)}
                className={clsx(
                  "relative flex h-16 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-xs font-ui-label font-bold uppercase tracking-wide transition-all disabled:opacity-60",
                  cfg.className
                )}
              >
                <Icon size={20} />
                {cfg.label}
                <span
                  className={clsx(
                    "kbd absolute right-2 top-1 opacity-60",
                    status === "passed" && "text-ink-primary"
                  )}
                >
                  {cfg.key}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-ink-tertiary">
          Shortcuts: Enter pass · F fail · B blocked · S skip · ← → navigate
        </p>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: RunCaseStatus }) {
  const colors: Record<RunCaseStatus, string> = {
    pending: "bg-border-medium",
    passed: "bg-pass",
    failed: "bg-fail",
    blocked: "bg-blocked",
    skipped: "bg-ink-tertiary",
  };
  return <span className={clsx("h-2.5 w-2.5 shrink-0 rounded-full", colors[status])} />;
}

function StatusBadge({ status }: { status: RunCaseStatus }) {
  if (status === "pending") return null;
  const tone = status === "passed" ? "green" : status === "failed" ? "red" : "amber";
  return <Badge tone={tone}>{status}</Badge>;
}
