"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StepsEditor } from "@/components/test-cases/steps-editor";
import type { ActionState } from "@/lib/actions/auth";
import type { TestCasePriority, TestCaseStatus, TestStep } from "@/lib/types/database";

const NEW_FEATURE_VALUE = "__new__";

export interface TestCaseFormValues {
  title?: string;
  preconditions?: string | null;
  priority?: TestCasePriority;
  status?: TestCaseStatus;
  steps?: TestStep[];
  tags?: string[];
  feature?: string;
}

export function TestCaseForm({
  action,
  initialValues,
  features,
  submitLabel = "Save test case",
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  initialValues?: TestCaseFormValues;
  features: string[];
  submitLabel?: string;
}) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(action, {});
  const knownFeature = initialValues?.feature && features.includes(initialValues.feature);
  const [featureChoice, setFeatureChoice] = useState<string>(
    initialValues?.feature ? (knownFeature ? initialValues.feature : NEW_FEATURE_VALUE) : features[0] ?? NEW_FEATURE_VALUE
  );

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" required defaultValue={initialValues?.title} />
      </div>

      <div>
        <Label htmlFor="feature">Feature</Label>
        <select
          id="feature"
          name="feature"
          value={featureChoice}
          onChange={(e) => setFeatureChoice(e.target.value)}
          className="block w-full rounded-md border border-border-medium px-3 py-2 text-sm text-ink-primary shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {features.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
          <option value={NEW_FEATURE_VALUE}>+ Add new feature…</option>
        </select>
        {featureChoice === NEW_FEATURE_VALUE && (
          <Input
            name="newFeature"
            required
            placeholder="e.g. Checkout, Payments, Onboarding"
            defaultValue={!knownFeature ? initialValues?.feature : undefined}
            className="mt-2"
          />
        )}
      </div>

      <div>
        <Label htmlFor="preconditions">Preconditions</Label>
        <textarea
          id="preconditions"
          name="preconditions"
          rows={2}
          defaultValue={initialValues?.preconditions ?? ""}
          className="block w-full rounded-md border border-border-medium px-3 py-2 text-sm text-ink-primary shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
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
            className="block w-full rounded-md border border-border-medium px-3 py-2 text-sm text-ink-primary shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
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
            className="block w-full rounded-md border border-border-medium px-3 py-2 text-sm text-ink-primary shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
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
        <p className="rounded-md bg-fail-soft px-3 py-2 text-sm text-fail">{state.error}</p>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
