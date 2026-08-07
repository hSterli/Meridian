"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { updateWeeklyReportDraft } from "@/lib/actions/weekly-reports";
import type { ActionState } from "@/lib/actions/auth";
import type { ReportRagStatus } from "@/lib/types/database";

const RAG_OPTIONS: { value: ReportRagStatus; label: string; tone: "red" | "amber" | "green" }[] = [
  { value: "green", label: "On Track", tone: "green" },
  { value: "amber", label: "At Risk", tone: "amber" },
  { value: "red", label: "Off Track", tone: "red" },
];

export function RagEditor({
  projectId,
  ragStatus,
  highlights,
}: {
  projectId: string;
  ragStatus: ReportRagStatus;
  highlights: string;
}) {
  const action = updateWeeklyReportDraft.bind(null, projectId);
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-3">
      <div>
        <div className="mb-1 text-xs font-ui-label font-semibold uppercase tracking-wide text-ink-tertiary">
          Overall Status
        </div>
        <div className="flex gap-2">
          {RAG_OPTIONS.map((opt) => (
            <label key={opt.value} className="cursor-pointer">
              <input
                type="radio"
                name="ragStatus"
                value={opt.value}
                defaultChecked={ragStatus === opt.value}
                className="peer sr-only"
              />
              <span className="peer-checked:ring-2 peer-checked:ring-primary rounded-full">
                <Badge tone={opt.tone}>{opt.label}</Badge>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs font-ui-label font-semibold uppercase tracking-wide text-ink-tertiary">
          Key Highlights
        </div>
        <textarea
          name="highlights"
          defaultValue={highlights}
          rows={4}
          placeholder="Key highlights for this week…"
          className="block w-full rounded-xl border border-border-light bg-paper-muted/50 px-4 py-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
        />
      </div>
      <Button type="submit" variant="secondary" disabled={isPending}>
        {isPending ? "Saving…" : "Save"}
      </Button>
      {state.error && <p className="text-xs text-fail">{state.error}</p>}
    </form>
  );
}
