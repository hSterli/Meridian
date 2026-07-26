"use client";

import { useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import type { TestStep } from "@/lib/types/database";

export function StepsEditor({ initialSteps = [] }: { initialSteps?: TestStep[] }) {
  const [steps, setSteps] = useState<TestStep[]>(
    initialSteps.length > 0 ? initialSteps : [{ step: "", expected: "" }]
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  function update(index: number, field: keyof TestStep, value: string) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }

  function addStep() {
    setSteps((prev) => [...prev, { step: "", expected: "" }]);
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function reorder(from: number, to: number) {
    setSteps((prev) => {
      if (from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  return (
    <div>
      <Label>Steps</Label>
      <div className="space-y-2">
        {steps.map((s, i) => (
          <div
            key={i}
            draggable
            onDragStart={() => setDragIndex(i)}
            onDragOver={(e) => {
              e.preventDefault();
              if (i !== overIndex) setOverIndex(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null) reorder(dragIndex, i);
              setDragIndex(null);
              setOverIndex(null);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
            className={`flex items-start gap-2 rounded-md ${
              overIndex === i && dragIndex !== null && dragIndex !== i
                ? "bg-paper-surface ring-1 ring-primary"
                : ""
            } ${dragIndex === i ? "opacity-50" : ""}`}
          >
            <span
              className="mt-2 cursor-grab text-ink-tertiary active:cursor-grabbing"
              aria-label="Drag to reorder"
            >
              <GripVertical size={16} />
            </span>
            <span className="mt-2.5 w-5 shrink-0 text-xs text-ink-tertiary">{i + 1}.</span>
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
              className="mt-2 text-ink-tertiary hover:text-fail"
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
