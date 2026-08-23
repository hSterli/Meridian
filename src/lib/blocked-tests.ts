export type BlockedRunStatus = "planned" | "in_progress" | "completed";
export type BlockedRunCaseStatus = "pending" | "passed" | "failed" | "blocked" | "skipped";

export interface RawBlockedRunCaseRow {
  testCaseId: string;
  title: string;
  projectId: string;
  runId: string;
  runName: string;
  runStatus: BlockedRunStatus;
  status: BlockedRunCaseStatus;
  executedAt: string | null;
  notes: string | null;
}

export interface BlockedTestEntry {
  testCaseId: string;
  title: string;
  projectId: string;
  runId: string;
  runName: string;
  blockedSince: string;
  notes: string | null;
}

const OPEN_RUN_STATUSES: BlockedRunStatus[] = ["planned", "in_progress"];

// Pure — no I/O. Takes the same shape of joined test_run_cases/test_runs rows
// the /reports page already fetches for the Flaky tests section, returns a
// filtered, sorted list of currently-blocked run-cases in still-open runs.
// See docs/superpowers/specs/2026-08-21-test-bottleneck-identification-design.md
// for the full rationale (no threshold, no time-decay — blocked is already a
// deliberate status, unlike flaky's noisy pass/fail history).
export function computeBlockedTests(rows: RawBlockedRunCaseRow[]): BlockedTestEntry[] {
  return rows
    .filter(
      (r): r is RawBlockedRunCaseRow & { executedAt: string } =>
        r.status === "blocked" && OPEN_RUN_STATUSES.includes(r.runStatus) && r.executedAt !== null
    )
    .sort((a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime())
    .map((r) => ({
      testCaseId: r.testCaseId,
      title: r.title,
      projectId: r.projectId,
      runId: r.runId,
      runName: r.runName,
      blockedSince: r.executedAt,
      notes: r.notes,
    }));
}
