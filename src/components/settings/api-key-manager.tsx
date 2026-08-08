"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ApiKeyActionState } from "@/lib/actions/api-keys";

export interface ApiKeyRow {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export function ApiKeyManager({
  keys,
  isAdmin,
  createAction,
  revokeAction,
}: {
  keys: ApiKeyRow[];
  isAdmin: boolean;
  createAction: (prevState: ApiKeyActionState, formData: FormData) => Promise<ApiKeyActionState>;
  revokeAction: (keyId: string) => void;
}) {
  const [state, formAction, isPending] = useActionState<ApiKeyActionState, FormData>(
    createAction,
    {}
  );

  return (
    <div className="space-y-6">
      {state.plaintextKey && (
        <Card className="border-primary/30 bg-meridian-soft/40 p-4">
          <p className="text-sm font-semibold text-ink-primary">
            Copy this key now — it won&apos;t be shown again.
          </p>
          <code className="mt-2 block break-all rounded-md bg-white px-3 py-2 text-xs">
            {state.plaintextKey}
          </code>
        </Card>
      )}

      <Card className="divide-y divide-border-light">
        {keys.length === 0 && (
          <p className="p-4 text-sm text-ink-tertiary">No API keys yet.</p>
        )}
        {keys.map((k) => (
          <div key={k.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm font-medium text-ink-primary">{k.name}</p>
              <p className="text-xs text-ink-tertiary">
                Created {new Date(k.created_at).toLocaleDateString("en-US", { timeZone: "UTC" })}
                {k.last_used_at
                  ? ` · Last used ${new Date(k.last_used_at).toLocaleDateString("en-US", { timeZone: "UTC" })}`
                  : " · Never used"}
                {k.revoked_at ? " · Revoked" : ""}
              </p>
            </div>
            {isAdmin && !k.revoked_at && (
              <button
                type="button"
                onClick={() => revokeAction(k.id)}
                className="text-xs font-medium text-fail hover:underline"
              >
                Revoke
              </button>
            )}
          </div>
        ))}
      </Card>

      {isAdmin && (
        <form action={formAction} className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="name">New key name</Label>
            <Input id="name" name="name" required placeholder="e.g. CI pipeline" />
          </div>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Creating…" : "Create key"}
          </Button>
        </form>
      )}
      {state.error && <p className="text-xs text-fail">{state.error}</p>}
    </div>
  );
}
