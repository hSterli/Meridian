"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inviteMember } from "@/lib/actions/members";
import type { ActionState } from "@/lib/actions/auth";

export function InviteForm() {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(inviteMember, {});

  return (
    <form action={formAction} className="flex items-end gap-2">
      <div className="flex-1">
        <Input name="email" type="email" placeholder="teammate@company.com" required />
      </div>
      <select
        name="role"
        defaultValue="member"
        className="rounded-md border border-border-medium px-2 py-2 text-sm text-ink-secondary"
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </select>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Inviting…" : "Invite"}
      </Button>
      {state.error && <span className="text-xs text-fail">{state.error}</span>}
    </form>
  );
}
