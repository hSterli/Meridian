"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { TestStep } from "@/lib/types/database";

export function StepsEditor({ initialSteps = [] }: { initialSteps?: TestStep[] }) {
  const [steps, setSteps] = useState<TestStep[]>(
    initialSteps.length > 0 ? initialSteps : [{ step: "", expected: "" }]
  );

  function update(index: number, field: keyof TestStep, value: string) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }

  function addStep() {
    setSteps((prev) => [...prev, { step: "", expected: "" }]);
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div>
      <Label>Steps</Label>
      <div className="space-y-2">
        {steps.map((s, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="mt-2.5 w-5 shrink-0 text-xs text-slate-400">{i + 1}.</span>
            <Input
              placeholder="Action"
              value={s.step}
              onChange={(e) => update(i, "step", e.target.value)}
              className="flex-1"
            />
            <Input
              placeholder="Expected result"
              value={s.expected}
              onChange={(e) => update(i, "expected", e.target.value)}
              className="flex-1"
            />
            <button
              type="button"
              onClick={() => removeStep(i)}
              className="mt-2 text-slate-400 hover:text-red-600"
              aria-label="Remove step"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      <Button type="button" variant="ghost" className="mt-2" onClick={addStep}>
        <Plus size={14} /> Add step
      </Button>
      <input type="hidden" name="steps" value={JSON.stringify(steps)} />
    </div>
  );
}
