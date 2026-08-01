"use client";

import { useActionState, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ActionState } from "@/lib/actions/auth";
import type { TestCaseCustomFieldType } from "@/lib/types/database";

export interface CustomFieldRow {
  id: string;
  name: string;
  field_type: TestCaseCustomFieldType;
  options: string[];
}

export function CustomFieldsManager({
  fields,
  createAction,
  updateAction,
  deleteAction,
}: {
  fields: CustomFieldRow[];
  createAction: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  updateAction: (
    fieldId: string,
    prevState: ActionState,
    formData: FormData
  ) => Promise<ActionState>;
  deleteAction: (fieldId: string) => void;
}) {
  return (
    <div className="space-y-6">
      <Card className="divide-y divide-border-light">
        {fields.length === 0 && (
          <p className="p-4 text-sm text-ink-tertiary">No custom fields yet — add one below.</p>
        )}
        {fields.map((field) => (
          <CustomFieldEditRow
            key={field.id}
            field={field}
            updateAction={updateAction}
            deleteAction={deleteAction}
          />
        ))}
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-secondary">Add a custom field</h2>
        <NewCustomFieldForm createAction={createAction} />
      </Card>
    </div>
  );
}

function CustomFieldEditRow({
  field,
  updateAction,
  deleteAction,
}: {
  field: CustomFieldRow;
  updateAction: (
    fieldId: string,
    prevState: ActionState,
    formData: FormData
  ) => Promise<ActionState>;
  deleteAction: (fieldId: string) => void;
}) {
  const boundUpdate = updateAction.bind(null, field.id);
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(boundUpdate, {});

  return (
    <form action={formAction} className="flex items-start gap-3 px-4 py-3">
      <div className="flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <Input name="name" defaultValue={field.name} className="flex-1" />
          <span className="rounded-full bg-surface-container-highest px-2 py-0.5 text-[11px] font-ui-label font-bold uppercase tracking-wide text-ink-tertiary">
            {field.field_type}
          </span>
        </div>
        {field.field_type === "select" && (
          <Input
            name="options"
            defaultValue={field.options.join(", ")}
            placeholder="Comma-separated options"
          />
        )}
        {state.error && <p className="text-xs text-fail">{state.error}</p>}
      </div>
      <Button type="submit" variant="secondary" disabled={isPending}>
        {isPending ? "Saving…" : "Save"}
      </Button>
      <button
        type="button"
        onClick={() => deleteAction(field.id)}
        className="mt-2 text-ink-tertiary hover:text-fail"
        aria-label={`Delete ${field.name}`}
      >
        <Trash2 size={16} />
      </button>
    </form>
  );
}

function NewCustomFieldForm({
  createAction,
}: {
  createAction: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(createAction, {});
  const [fieldType, setFieldType] = useState<TestCaseCustomFieldType>("text");

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="newFieldName">Name</Label>
          <Input id="newFieldName" name="name" required placeholder="e.g. Component" />
        </div>
        <div>
          <Label htmlFor="newFieldType">Type</Label>
          <Select
            id="newFieldType"
            name="fieldType"
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as TestCaseCustomFieldType)}
            className="w-full"
          >
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="select">Dropdown</option>
          </Select>
        </div>
      </div>
      {fieldType === "select" && (
        <div>
          <Label htmlFor="newFieldOptions">Options (comma-separated)</Label>
          <Input id="newFieldOptions" name="options" placeholder="Frontend, Backend, API" />
        </div>
      )}
      {state.error && <p className="text-xs text-fail">{state.error}</p>}
      <Button type="submit" disabled={isPending}>
        {isPending ? "Adding…" : "Add field"}
      </Button>
    </form>
  );
}
