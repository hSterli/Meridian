"use client";

import { useActionState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { bulkImportTestCases } from "@/lib/actions/test-cases";
import type { ActionState } from "@/lib/actions/auth";

export function ImportCsvForm({ projectId }: { projectId: string }) {
  const action = bulkImportTestCases.bind(null, projectId);
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(action, {});
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (formData) => {
        await formAction(formData);
        formRef.current?.reset();
      }}
      className="flex items-center gap-2"
    >
      <input
        type="file"
        name="file"
        accept=".csv"
        required
        className="text-xs text-slate-600 file:mr-2 file:rounded-md file:border-0 file:bg-slate-100 file:px-2 file:py-1.5 file:text-xs file:font-medium"
      />
      <Button type="submit" variant="secondary" disabled={isPending}>
        {isPending ? "Importing…" : "Import CSV"}
      </Button>
      {state.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}
