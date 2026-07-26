"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { inviteMember } from "@/lib/actions/members";
import type { ActionState } from "@/lib/actions/auth";

export function InviteForm() {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(inviteMember, {});

  return (
    <form action={formAction} className="flex items-end gap-2">
      <div className="flex-1">
        <Input name="email" type="email" placeholder="teammate@company.com" required />
      </div>
      <Select name="role" defaultValue="member" className="text-ink-secondary">
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </Select>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Inviting…" : "Invite"}
      </Button>
      {state.error && <span className="text-xs text-fail">{state.error}</span>}
    </form>
  );
}
