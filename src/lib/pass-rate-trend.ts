export type TrendRunCaseStatus = "pending" | "passed" | "failed" | "blocked" | "skipped";

export interface RawTrendRunCaseRow {
  status: TrendRunCaseStatus;
  executedAt: string | null;
}

export interface DailyPassRate {
  date: string; // YYYY-MM-DD
  passed: number;
  failed: number;
  passRate: number; // 0..1
}

const DEFAULT_DAYS = 30;

// Pure — no I/O, no wall-clock dependency. Groups passed/failed rows by
// their UTC calendar date and computes each day's pass rate. The real
// 30-day window is enforced once, server-side, by the caller's query
// (executed_at >= 30 days ago) — `days` here only trims the *output* to the
// most recent N distinct dates actually present in the input, so tests can
// exercise it deterministically without touching the system clock. See
// docs/superpowers/specs/2026-08-24-pass-fail-trend-design.md.
export function computePassRateTrend(
  rows: RawTrendRunCaseRow[],
  days: number = DEFAULT_DAYS
): DailyPassRate[] {
  const byDate = new Map<string, { passed: number; failed: number }>();

  for (const row of rows) {
    if (row.status !== "passed" && row.status !== "failed") continue;
    if (!row.executedAt) continue;

    const dateKey = row.executedAt.slice(0, 10);
    const entry = byDate.get(dateKey) ?? { passed: 0, failed: 0 };
    if (row.status === "passed") entry.passed += 1;
    else entry.failed += 1;
    byDate.set(dateKey, entry);
  }

  const sorted = Array.from(byDate.entries())
    .map(([date, { passed, failed }]) => ({
      date,
      passed,
      failed,
      passRate: passed / (passed + failed),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return sorted.length > days ? sorted.slice(sorted.length - days) : sorted;
}
