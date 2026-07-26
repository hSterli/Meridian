"use client";

import { useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { clsx } from "clsx";

export function NumberStepper({
  id,
  name,
  defaultValue,
  min = 0,
  placeholder,
  className,
}: {
  id?: string;
  name: string;
  defaultValue?: number | string | null;
  min?: number;
  placeholder?: string;
  className?: string;
}) {
  const [value, setValue] = useState<string>(
    defaultValue != null && defaultValue !== "" ? String(defaultValue) : ""
  );

  function step(delta: number) {
    setValue((prev) => {
      const current = prev === "" ? min - delta : Number.parseInt(prev, 10);
      const base = Number.isFinite(current) ? current : min - delta;
      return String(Math.max(min, base + delta));
    });
  }

  return (
    <div
      className={clsx(
        "flex items-stretch overflow-hidden rounded-lg border border-border-medium bg-white shadow-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20",
        className
      )}
    >
      <input
        id={id}
        type="text"
        inputMode="numeric"
        name={name}
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
        className="w-full min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm text-ink-primary focus:outline-none"
      />
      <div className="flex flex-col border-l border-border-light">
        <button
          type="button"
          onClick={() => step(1)}
          tabIndex={-1}
          aria-label="Increase"
          className="flex flex-1 items-center justify-center px-2 text-ink-tertiary transition-colors hover:bg-paper-surface hover:text-ink-primary"
        >
          <ChevronUp size={12} />
        </button>
        <button
          type="button"
          onClick={() => step(-1)}
          tabIndex={-1}
          aria-label="Decrease"
          className="flex flex-1 items-center justify-center border-t border-border-light px-2 text-ink-tertiary transition-colors hover:bg-paper-surface hover:text-ink-primary"
        >
          <ChevronDown size={12} />
        </button>
      </div>
    </div>
  );
}
