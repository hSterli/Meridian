"use client";

import { useState, useTransition } from "react";
import { clsx } from "clsx";
import { updateDailyPlan } from "@/lib/actions/weekly-reports";
import type { DailyExecutionEntry } from "@/lib/weekly-report-metrics";

function weekdayLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
}

export function DailyExecutionTable({
  projectId,
  days,
}: {
  projectId: string;
  days: DailyExecutionEntry[];
}) {
  const [planned, setPlanned] = useState<Record<string, number>>(
    Object.fromEntries(days.map((d) => [d.date, d.planned]))
  );
  const [, startTransition] = useTransition();

  function handlePlannedChange(date: string, value: number) {
    setPlanned((prev) => ({ ...prev, [date]: value }));
    startTransition(async () => {
      await updateDailyPlan(projectId, date, value);
    });
  }

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="text-xs text-ink-tertiary">
          <th className="pb-2">Day</th>
          <th className="pb-2">Planned</th>
          <th className="pb-2">Actual</th>
          <th className="pb-2">Passed</th>
          <th className="pb-2">Failed</th>
          <th className="pb-2">Blocked</th>
          <th className="pb-2">Variance</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border-light">
        {days.map((d) => {
          const plannedValue = planned[d.date] ?? 0;
          const variance = d.actual - plannedValue;
          return (
            <tr key={d.date}>
              <td className="py-2">
                {weekdayLabel(d.date)} <span className="text-ink-tertiary">{d.date}</span>
              </td>
              <td className="py-2">
                <input
                  type="number"
                  min={0}
                  value={plannedValue}
                  onChange={(e) => handlePlannedChange(d.date, Number(e.target.value))}
                  className="w-16 rounded-md border border-border-light px-2 py-1 text-sm"
                />
              </td>
              <td className="py-2">{d.actual}</td>
              <td className="py-2">{d.passed}</td>
              <td className="py-2">{d.failed}</td>
              <td className="py-2">{d.blocked}</td>
              <td
                className={clsx(
                  "py-2 font-semibold",
                  variance > 0 ? "text-pass" : variance < 0 ? "text-fail" : "text-ink-tertiary"
                )}
              >
                {variance > 0 ? `+${variance}` : variance}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
