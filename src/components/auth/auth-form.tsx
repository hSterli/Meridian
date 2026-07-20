"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionState } from "@/lib/actions/auth";

export function AuthForm({
  mode,
  action,
}: {
  mode: "login" | "signup";
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction, isPending] = useActionState(action, {});

  return (
    <form action={formAction} className="space-y-4">
      {mode === "signup" && (
        <div>
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" name="fullName" type="text" required autoComplete="name" />
        </div>
      )}
      <div>
        <Label htmlFor="email">Work email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={6}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
        />
      </div>

      {state.error && (
        <p className="rounded-lg bg-fail-soft px-3 py-2 text-sm text-fail">{state.error}</p>
      )}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Please wait…" : mode === "signup" ? "Create account" : "Log in"}
      </Button>

      <p className="text-center text-sm text-ink-secondary">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-primary hover:text-meridian-dark">
              Log in
            </Link>
          </>
        ) : (
          <>
            New to Meridian?{" "}
            <Link href="/signup" className="font-semibold text-primary hover:text-meridian-dark">
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
