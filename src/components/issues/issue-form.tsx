"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
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
        <p className="rounded-md bg-meridian-soft px-3 py-2 text-sm text-primary">
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
          className="block w-full rounded-md border border-border-medium px-3 py-2 text-sm text-ink-primary shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div>
        <Label htmlFor="severity">Severity</Label>
        <Select id="severity" name="severity" defaultValue="medium" className="w-full">
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </Select>
      </div>

      {state.error && (
        <p className="rounded-md bg-fail-soft px-3 py-2 text-sm text-fail">{state.error}</p>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Creating…" : "Create issue"}
      </Button>
    </form>
  );
}
