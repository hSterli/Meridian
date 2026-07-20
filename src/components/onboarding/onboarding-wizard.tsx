"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createOrganizationAndProject } from "@/lib/actions/orgs";
import type { ActionState } from "@/lib/actions/auth";
import { clsx } from "clsx";

const TEMPLATES = [
  { id: "web", label: "Web app QA", description: "Login, forms, core user flows" },
  { id: "mobile", label: "Mobile QA", description: "Onboarding, install, device flows" },
  { id: "api", label: "API testing", description: "Endpoint health and contract checks" },
  { id: "blank", label: "Start blank", description: "No sample test cases" },
] as const;

export function OnboardingWizard() {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    createOrganizationAndProject,
    {}
  );
  const [step, setStep] = useState(1);
  const [template, setTemplate] = useState<string>("web");

  return (
    <form action={formAction} className="space-y-6">
      <div className="flex items-center gap-2 text-xs font-ui-label font-semibold text-ink-tertiary">
        <span className={step === 1 ? "text-primary" : ""}>1. Your team</span>
        <span>→</span>
        <span className={step === 2 ? "text-primary" : ""}>2. First project</span>
      </div>

      <div className={clsx("space-y-4", step !== 1 && "hidden")}>
        <div>
          <Label htmlFor="orgName">Team / organization name</Label>
          <Input id="orgName" name="orgName" placeholder="Acme QA" required />
        </div>
        <Button type="button" onClick={() => setStep(2)}>
          Continue
        </Button>
      </div>

      <div className={clsx("space-y-4", step !== 2 && "hidden")}>
        <div>
          <Label htmlFor="projectName">First project name</Label>
          <Input id="projectName" name="projectName" placeholder="Main Product" required />
        </div>

        <div>
          <Label>Starter template</Label>
          <div className="grid grid-cols-2 gap-2">
            {TEMPLATES.map((t) => (
              <label
                key={t.id}
                className={clsx(
                  "cursor-pointer rounded-lg border p-3 text-sm transition-colors",
                  template === t.id
                    ? "border-primary bg-meridian-soft"
                    : "border-border-light hover:border-border-medium"
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
                <div className="font-ui-label font-semibold text-ink-primary">{t.label}</div>
                <div className="text-xs text-ink-tertiary">{t.description}</div>
              </label>
            ))}
          </div>
        </div>

        {state.error && (
          <p className="rounded-lg bg-fail-soft px-3 py-2 text-sm text-fail">{state.error}</p>
        )}

        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => setStep(1)}>
            Back
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Setting up…" : "Create project"}
          </Button>
        </div>
      </div>
    </form>
  );
}
