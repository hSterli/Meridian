"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfile, type ActionState } from "@/lib/actions/auth";

export function ProfileForm({ fullName, email }: { fullName: string | null; email: string | null }) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(updateProfile, {});

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="fullName">Full name</Label>
        <Input id="fullName" name="fullName" required defaultValue={fullName ?? ""} />
      </div>
      <div>
        <Label htmlFor="email">Work email</Label>
        <Input id="email" value={email ?? ""} disabled />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Save"}
        </Button>
        {state.success && <span className="text-xs font-semibold text-pass">Saved.</span>}
        {state.error && <span className="text-xs text-fail">{state.error}</span>}
      </div>
    </form>
  );
}
