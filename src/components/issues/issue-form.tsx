"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionState } from "@/lib/actions/auth";

export function IssueForm({
  action,
  linkedTestCaseId,
  linkedRunCaseId,
  linkedTestCaseTitle,
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  linkedTestCaseId?: string;
  linkedRunCaseId?: string;
  linkedTestCaseTitle?: string;
}) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-4">
      {linkedTestCaseTitle && (
        <p className="rounded-md bg-indigo-50 px-3 py-2 text-sm text-indigo-700">
          Linked to test case: <span className="font-medium">{linkedTestCaseTitle}</span>
        </p>
      )}
      <input type="hidden" name="linkedTestCaseId" value={linkedTestCaseId ?? ""} />
      <input type="hidden" name="linkedRunCaseId" value={linkedRunCaseId ?? ""} />

      <div>
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" required />
      </div>

      <div>
        <Label htmlFor="description">Description</Label>
        <textarea
          id="description"
          name="description"
          rows={4}
          className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <div>
        <Label htmlFor="severity">Severity</Label>
        <select
          id="severity"
          name="severity"
          defaultValue="medium"
          className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </div>

      {state.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Creating…" : "Create issue"}
      </Button>
    </form>
  );
}
