"use client";

import { useActionState, useState } from "react";
import { clsx } from "clsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createProject } from "@/lib/actions/projects";
import type { ActionState } from "@/lib/actions/auth";

const TEMPLATES = [
  { id: "web", label: "Web app QA" },
  { id: "mobile", label: "Mobile QA" },
  { id: "api", label: "API testing" },
  { id: "blank", label: "Blank" },
] as const;

export function NewProjectForm() {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(createProject, {});
  const [template, setTemplate] = useState<string>("blank");

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <Label htmlFor="name">Project name</Label>
        <Input id="name" name="name" placeholder="Main Product" required />
      </div>

      <div>
        <Label>Starter template</Label>
        <div className="grid grid-cols-2 gap-2">
          {TEMPLATES.map((t) => (
            <label
              key={t.id}
              className={clsx(
                "cursor-pointer rounded-md border p-3 text-sm transition-colors",
                template === t.id ? "border-primary bg-meridian-soft" : "border-border-light hover:border-border-medium"
              )}
            >
              <input
                type="radio"
                name="template"
                value={t.id}
                checked={template === t.id}
                onChange={() => setTemplate(t.id)}
                className="sr-only"
              />
              <div className="font-medium text-ink-primary">{t.label}</div>
            </label>
          ))}
        </div>
      </div>

      {state.error && (
        <p className="rounded-md bg-fail-soft px-3 py-2 text-sm text-fail">{state.error}</p>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Creating…" : "Create project"}
      </Button>
    </form>
  );
}
