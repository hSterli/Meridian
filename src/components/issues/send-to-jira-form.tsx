"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/lib/actions/auth";

export function SendToJiraForm({
  action,
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(action, {});

  return (
    <form action={formAction} className="mb-4">
      <Button type="submit" variant="secondary" disabled={isPending}>
        {isPending ? "Sending…" : "Send to Jira"}
      </Button>
      {state.error && <p className="mt-1 text-xs text-fail">{state.error}</p>}
    </form>
  );
}
