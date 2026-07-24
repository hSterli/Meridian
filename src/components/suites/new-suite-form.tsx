"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TestCasePicker } from "@/components/test-cases/test-case-picker";
import type { ActionState } from "@/lib/actions/auth";

interface TestCaseOption {
  id: string;
  title: string;
  priority: string;
}

export function NewSuiteForm({
  action,
  testCases,
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  testCases: TestCaseOption[];
}) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-5">
      <div>
        <Label htmlFor="name">Suite name</Label>
        <Input id="name" name="name" placeholder="Regression" required />
      </div>

      <div>
        <Label className="mb-2">Test cases</Label>
        <TestCasePicker testCases={testCases} />
      </div>

      {state.error && (
        <p className="rounded-md bg-fail-soft px-3 py-2 text-sm text-fail">{state.error}</p>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Creating…" : "Create suite"}
      </Button>
    </form>
  );
}
