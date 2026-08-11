"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { JiraConnectionActionState } from "@/lib/actions/issue-tracker";

export interface JiraConnectionRow {
  id: string;
  jira_base_url: string;
  jira_email: string;
  jira_project_key: string;
}

export function JiraConnectionManager({
  connection,
  isAdmin,
  connectAction,
  disconnectAction,
}: {
  connection: JiraConnectionRow | null;
  isAdmin: boolean;
  connectAction: (
    prevState: JiraConnectionActionState,
    formData: FormData
  ) => Promise<JiraConnectionActionState>;
  disconnectAction: (() => void) | null;
}) {
  const [state, formAction, isPending] = useActionState<JiraConnectionActionState, FormData>(
    connectAction,
    {}
  );

  if (connection) {
    return (
      <Card className="p-4">
        <p className="text-sm font-medium text-ink-primary">Connected to {connection.jira_base_url}</p>
        <p className="text-xs text-ink-tertiary">
          Project {connection.jira_project_key} · {connection.jira_email}
        </p>
        {isAdmin && (
          <button
            type="button"
            onClick={() => disconnectAction?.()}
            className="mt-2 text-xs font-medium text-fail hover:underline"
          >
            Disconnect
          </button>
        )}
      </Card>
    );
  }

  if (!isAdmin) {
    return <Card className="p-4 text-sm text-ink-tertiary">No Jira connection configured.</Card>;
  }

  if (state.webhookUrl) {
    return (
      <Card className="border-primary/30 bg-meridian-soft/40 p-4">
        <p className="text-sm font-semibold text-ink-primary">Connected! One more step:</p>
        <p className="mt-1 text-sm text-ink-secondary">
          In Jira, go to Settings → System → WebHooks and add this URL, filtered to Issue
          created/updated events:
        </p>
        <code className="mt-2 block break-all rounded-md bg-white px-3 py-2 text-xs">
          {state.webhookUrl}
        </code>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <form action={formAction} className="space-y-3">
        <div>
          <Label htmlFor="baseUrl">Jira URL</Label>
          <Input id="baseUrl" name="baseUrl" required placeholder="https://yourcompany.atlassian.net" />
        </div>
        <div>
          <Label htmlFor="email">Account email</Label>
          <Input id="email" name="email" type="email" required />
        </div>
        <div>
          <Label htmlFor="apiToken">API token</Label>
          <Input id="apiToken" name="apiToken" type="password" required />
        </div>
        <div>
          <Label htmlFor="projectKey">Jira project key</Label>
          <Input id="projectKey" name="projectKey" required placeholder="PROJ" />
        </div>
        {state.error && <p className="text-xs text-fail">{state.error}</p>}
        <Button type="submit" disabled={isPending}>
          {isPending ? "Connecting…" : "Connect Jira"}
        </Button>
      </form>
    </Card>
  );
}
