"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StepsEditor } from "@/components/test-cases/steps-editor";
import type { ActionState } from "@/lib/actions/auth";
import type { TestCasePriority, TestCaseStatus, TestStep } from "@/lib/types/database";

export interface TestCaseFormValues {
  title?: string;
  preconditions?: string | null;
  priority?: TestCasePriority;
  status?: TestCaseStatus;
  steps?: TestStep[];
  tags?: string[];
}

export function TestCaseForm({
  action,
  initialValues,
  submitLabel = "Save test case",
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  initialValues?: TestCaseFormValues;
  submitLabel?: string;
}) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" required defaultValue={initialValues?.title} />
      </div>

      <div>
        <Label htmlFor="preconditions">Preconditions</Label>
        <textarea
          id="preconditions"
          name="preconditions"
          rows={2}
          defaultValue={initialValues?.preconditions ?? ""}
          className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      <StepsEditor initialSteps={initialValues?.steps} />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="priority">Priority</Label>
          <select
            id="priority"
            name="priority"
            defaultValue={initialValues?.priority ?? "medium"}
            className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <div>
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            name="status"
            defaultValue={initialValues?.status ?? "active"}
            className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="deprecated">Deprecated</option>
          </select>
        </div>
      </div>

      <div>
        <Label htmlFor="tags">Tags (comma-separated)</Label>
        <Input id="tags" name="tags" defaultValue={initialValues?.tags?.join(", ")} placeholder="smoke, regression" />
      </div>

      {state.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
