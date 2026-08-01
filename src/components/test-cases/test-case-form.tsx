"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberStepper } from "@/components/ui/number-stepper";
import { Select } from "@/components/ui/select";
import { StepsEditor } from "@/components/test-cases/steps-editor";
import type { ActionState } from "@/lib/actions/auth";
import type {
  TestCaseAutomationStatus,
  TestCaseCustomFieldType,
  TestCasePriority,
  TestCaseStatus,
  TestStep,
} from "@/lib/types/database";

const NEW_FEATURE_VALUE = "__new__";

export interface OrgMemberOption {
  user_id: string;
  email: string;
}

export interface CustomFieldDefinition {
  id: string;
  name: string;
  field_type: TestCaseCustomFieldType;
  options: string[];
}

export interface TestCaseFormValues {
  title?: string;
  preconditions?: string | null;
  priority?: TestCasePriority;
  status?: TestCaseStatus;
  steps?: TestStep[];
  tags?: string[];
  feature?: string;
  sprintNumber?: number | null;
  assignedTo?: string | null;
  automationStatus?: TestCaseAutomationStatus;
  automationScriptRef?: string | null;
  referenceLink?: string | null;
  customFieldValues?: Record<string, string>;
}

export function TestCaseForm({
  action,
  initialValues,
  features,
  orgMembers = [],
  suites,
  defaultSuiteId,
  customFields = [],
  submitLabel = "Save test case",
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  initialValues?: TestCaseFormValues;
  features: string[];
  orgMembers?: OrgMemberOption[];
  suites?: { id: string; name: string }[];
  defaultSuiteId?: string;
  customFields?: CustomFieldDefinition[];
  submitLabel?: string;
}) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(action, {});
  const knownFeature = initialValues?.feature && features.includes(initialValues.feature);
  const [featureChoice, setFeatureChoice] = useState<string>(
    initialValues?.feature ? (knownFeature ? initialValues.feature : NEW_FEATURE_VALUE) : features[0] ?? NEW_FEATURE_VALUE
  );
  const [automationStatus, setAutomationStatus] = useState<TestCaseAutomationStatus>(
    initialValues?.automationStatus ?? "manual_only"
  );

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" required defaultValue={initialValues?.title} />
      </div>

      <div>
        <Label htmlFor="feature">Feature</Label>
        <Select
          id="feature"
          name="feature"
          value={featureChoice}
          onChange={(e) => setFeatureChoice(e.target.value)}
          className="w-full"
        >
          {features.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
          <option value={NEW_FEATURE_VALUE}>+ Add new feature…</option>
        </Select>
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
          <Select
            id="priority"
            name="priority"
            defaultValue={initialValues?.priority ?? "medium"}
            className="w-full"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="status">Status</Label>
          <Select
            id="status"
            name="status"
            defaultValue={initialValues?.status ?? "active"}
            className="w-full"
          >
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="deprecated">Deprecated</option>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="tags">Tags (comma-separated)</Label>
          <Input
            id="tags"
            name="tags"
            defaultValue={initialValues?.tags?.join(", ")}
            placeholder="smoke, regression"
          />
        </div>
        <div>
          <Label htmlFor="sprintNumber">Sprint (optional)</Label>
          <NumberStepper
            id="sprintNumber"
            name="sprintNumber"
            min={0}
            defaultValue={initialValues?.sprintNumber}
            placeholder="e.g. 14"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="assignedTo">Owner</Label>
          <Select
            id="assignedTo"
            name="assignedTo"
            defaultValue={initialValues?.assignedTo ?? ""}
            className="w-full"
          >
            <option value="">Unassigned</option>
            {orgMembers.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.email}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="referenceLink">Reference link (optional)</Label>
          <Input
            id="referenceLink"
            name="referenceLink"
            type="url"
            defaultValue={initialValues?.referenceLink ?? ""}
            placeholder="https://jira.example.com/PROJ-123"
          />
        </div>
      </div>

      <div>
        <Label>Automation status</Label>
        <div className="flex gap-4">
          {(
            [
              { value: "manual_only", label: "Manual only" },
              { value: "to_be_automated", label: "To be automated" },
              { value: "automated", label: "Automated" },
            ] as { value: TestCaseAutomationStatus; label: string }[]
          ).map((opt) => (
            <label key={opt.value} className="flex items-center gap-1.5 text-sm text-ink-secondary">
              <input
                type="radio"
                name="automationStatus"
                value={opt.value}
                checked={automationStatus === opt.value}
                onChange={() => setAutomationStatus(opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>
        {automationStatus !== "manual_only" && (
          <Input
            name="automationScriptRef"
            defaultValue={initialValues?.automationScriptRef ?? ""}
            placeholder="Script path or identifier, e.g. e2e/checkout.spec.ts"
            className="mt-2"
          />
        )}
      </div>

      {suites && suites.length > 0 && (
        <div>
          <Label htmlFor="suiteId">Add to test suite (optional)</Label>
          <Select
            id="suiteId"
            name="suiteId"
            defaultValue={defaultSuiteId ?? ""}
            className="w-full"
          >
            <option value="">None</option>
            {suites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      {customFields.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {customFields.map((field) => (
            <div key={field.id}>
              <Label htmlFor={`customField_${field.id}`}>{field.name}</Label>
              {field.field_type === "select" ? (
                <Select
                  id={`customField_${field.id}`}
                  name={`customField_${field.id}`}
                  defaultValue={initialValues?.customFieldValues?.[field.id] ?? ""}
                  className="w-full"
                >
                  <option value="">—</option>
                  {field.options.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </Select>
              ) : field.field_type === "number" ? (
                <Input
                  id={`customField_${field.id}`}
                  name={`customField_${field.id}`}
                  type="number"
                  defaultValue={initialValues?.customFieldValues?.[field.id] ?? ""}
                />
              ) : (
                <Input
                  id={`customField_${field.id}`}
                  name={`customField_${field.id}`}
                  defaultValue={initialValues?.customFieldValues?.[field.id] ?? ""}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {state.error && (
        <p className="rounded-md bg-fail-soft px-3 py-2 text-sm text-fail">{state.error}</p>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
