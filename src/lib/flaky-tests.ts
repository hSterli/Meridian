export type FlakyRunCaseStatus = "pending" | "passed" | "failed" | "blocked" | "skipped";

export interface RawFlakyRunCaseRow {
  testCaseId: string;
  title: string;
  status: FlakyRunCaseStatus;
  executedAt: string | null;
}

export interface FlakyTestEntry {
  testCaseId: string;
  title: string;
  passed: number;
  failed: number;
  total: number;
  score: number; // min(passed, failed) / total, 0..0.5
}

export interface ComputeFlakyTestsOptions {
  windowSize?: number;
  minExecutions?: number;
  limit?: number;
}

const DEFAULT_WINDOW_SIZE = 10;
const DEFAULT_MIN_EXECUTIONS = 3;

// Pure — no I/O. Takes the same shape of joined test_run_cases/test_cases.title
// rows every caller already fetches, returns a scored, sorted, optionally
// capped list. See docs/superpowers/specs/2026-08-17-flaky-test-detection-design.md
// for the full rationale (bounded window instead of all-history or
// time-decay scoring).
export function computeFlakyTests(
  rows: RawFlakyRunCaseRow[],
  options?: ComputeFlakyTestsOptions
): FlakyTestEntry[] {
  const windowSize = options?.windowSize ?? DEFAULT_WINDOW_SIZE;
  const minExecutions = options?.minExecutions ?? DEFAULT_MIN_EXECUTIONS;

  // blocked/skipped/pending say nothing about pass/fail flakiness and must
  // never occupy a window slot — discard them before windowing, not after.
  const byTestCase = new Map<string, { title: string; rows: RawFlakyRunCaseRow[] }>();
  for (const row of rows) {
    if (row.status !== "passed" && row.status !== "failed") continue;
    const entry = byTestCase.get(row.testCaseId) ?? { title: row.title, rows: [] };
    entry.rows.push(row);
    byTestCase.set(row.testCaseId, entry);
  }

  const entries: FlakyTestEntry[] = [];
  for (const [testCaseId, { title, rows: caseRows }] of byTestCase) {
    const windowed = [...caseRows]
      .sort((a, b) => {
        const aTime = a.executedAt ? new Date(a.executedAt).getTime() : -Infinity;
        const bTime = b.executedAt ? new Date(b.executedAt).getTime() : -Infinity;
        return bTime - aTime;
      })
      .slice(0, windowSize);

    const total = windowed.length;
    if (total < minExecutions) continue;

    const passed = windowed.filter((r) => r.status === "passed").length;
    const failed = windowed.filter((r) => r.status === "failed").length;

    entries.push({ testCaseId, title, passed, failed, total, score: Math.min(passed, failed) / total });
  }

  entries.sort((a, b) => (b.score !== a.score ? b.score - a.score : b.total - a.total));

  return options?.limit ? entries.slice(0, options.limit) : entries;
}
