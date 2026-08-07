"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { updateSnapshotEditorialFields } from "@/lib/actions/weekly-reports";
import type { ActionState } from "@/lib/actions/auth";
import type { ReportRagStatus } from "@/lib/types/database";

const RAG_OPTIONS: { value: ReportRagStatus; label: string; tone: "red" | "amber" | "green" }[] = [
  { value: "green", label: "On Track", tone: "green" },
  { value: "amber", label: "At Risk", tone: "amber" },
  { value: "red", label: "Off Track", tone: "red" },
];

export function SnapshotRagEditor({
  projectId,
  snapshotId,
  ragStatus,
  highlights,
}: {
  projectId: string;
  snapshotId: string;
  ragStatus: ReportRagStatus;
  highlights: string;
}) {
  async function action(_prevState: ActionState, formData: FormData): Promise<ActionState> {
    const ragRaw = formData.get("ragStatus");
    const text = formData.get("highlights");
    if (ragRaw !== "red" && ragRaw !== "amber" && ragRaw !== "green") {
      return { error: "Choose a valid RAG status." };
    }
    // See the matching comment in updateWeeklyReportDraft (weekly-reports.ts)
    // for why this can't just use `ragRaw` directly after the checks above.
    const rag: ReportRagStatus = ragRaw === "red" ? "red" : ragRaw === "amber" ? "amber" : "green";
    return updateSnapshotEditorialFields(projectId, snapshotId, rag, typeof text === "string" ? text : "");
  }

  const [state, formAction, isPending] = useActionState<ActionState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-3">
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
      <textarea
        name="highlights"
        defaultValue={highlights}
        rows={4}
        className="block w-full rounded-xl border border-border-light bg-paper-muted/50 px-4 py-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
      />
      <Button type="submit" variant="secondary" disabled={isPending}>
        {isPending ? "Saving…" : "Save correction"}
      </Button>
      {state.error && <p className="text-xs text-fail">{state.error}</p>}
    </form>
  );
}
