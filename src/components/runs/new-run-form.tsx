"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionState } from "@/lib/actions/auth";

interface TestCaseOption {
  id: string;
  title: string;
  priority: string;
}

export function NewRunForm({
  action,
  testCases,
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  testCases: TestCaseOption[];
}) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(action, {});
  const [selected, setSelected] = useState<Set<string>>(new Set(testCases.map((t) => t.id)));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <Label htmlFor="name">Run name</Label>
        <Input id="name" name="name" placeholder="Regression — Sprint 14" required />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label className="mb-0">Test cases ({selected.size} selected)</Label>
          <button
            type="button"
            className="text-xs font-medium text-indigo-600"
            onClick={() =>
              setSelected(selected.size === testCases.length ? new Set() : new Set(testCases.map((t) => t.id)))
            }
          >
            {selected.size === testCases.length ? "Deselect all" : "Select all"}
          </button>
        </div>
        <div className="max-h-80 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
          {testCases.map((tc) => (
            <label key={tc.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
              <input
                type="checkbox"
                name="testCaseIds"
                value={tc.id}
                checked={selected.has(tc.id)}
                onChange={() => toggle(tc.id)}
                className="rounded border-slate-300"
              />
              <span className="flex-1 text-slate-700">{tc.title}</span>
              <span className="text-xs text-slate-400">{tc.priority}</span>
            </label>
          ))}
          {testCases.length === 0 && (
            <p className="px-2 py-4 text-center text-sm text-slate-400">
              No test cases in this project yet.
            </p>
          )}
        </div>
      </div>

      {state.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <Button type="submit" disabled={isPending || testCases.length === 0}>
        {isPending ? "Creating…" : "Start run"}
      </Button>
    </form>
  );
}
