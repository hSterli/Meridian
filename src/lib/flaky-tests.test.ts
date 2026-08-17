import { describe, expect, it } from "vitest";
import { computeFlakyTests, type RawFlakyRunCaseRow } from "./flaky-tests";

function row(
  testCaseId: string,
  status: RawFlakyRunCaseRow["status"],
  executedAt: string | null,
  title = "Test"
): RawFlakyRunCaseRow {
  return { testCaseId, title, status, executedAt };
}

describe("computeFlakyTests", () => {
  it("excludes a test case below the minimum-executions threshold", () => {
    const rows = [
      row("tc-1", "passed", "2026-08-10T00:00:00Z"),
      row("tc-1", "failed", "2026-08-11T00:00:00Z"),
    ];
    expect(computeFlakyTests(rows)).toEqual([]);
  });

  it("scores a test with 10 consecutive clean passes as exactly 0", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      row("tc-1", "passed", `2026-08-${String(11 + i).padStart(2, "0")}T00:00:00Z`)
    );
    const result = computeFlakyTests(rows);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      testCaseId: "tc-1",
      passed: 10,
      failed: 0,
      total: 10,
      score: 0,
    });
  });

  it("ignores an older 11th execution once it falls outside the window", () => {
    const rows = [
      // Oldest — an 11th execution, and a failure. Should be pushed out of the
      // window entirely once the 10 more recent passes are counted.
      row("tc-1", "failed", "2026-08-01T00:00:00Z"),
      ...Array.from({ length: 10 }, (_, i) =>
        row("tc-1", "passed", `2026-08-${String(11 + i).padStart(2, "0")}T00:00:00Z`)
      ),
    ];
    const result = computeFlakyTests(rows);
    expect(result[0]).toMatchObject({ passed: 10, failed: 0, total: 10, score: 0 });
  });

  it("excludes blocked, skipped, and pending results from both the window and the total", () => {
    const rows = [
      row("tc-1", "passed", "2026-08-10T00:00:00Z"),
      row("tc-1", "failed", "2026-08-11T00:00:00Z"),
      row("tc-1", "blocked", "2026-08-12T00:00:00Z"),
      row("tc-1", "skipped", "2026-08-13T00:00:00Z"),
      row("tc-1", "pending", null),
      row("tc-1", "passed", "2026-08-14T00:00:00Z"),
    ];
    const result = computeFlakyTests(rows, { minExecutions: 3 });
    expect(result[0]).toMatchObject({ total: 3, passed: 2, failed: 1 });
  });

  it("tie-breaks equal scores by total execution count, descending", () => {
    const rows = [
      // tc-1: 1 pass, 1 fail -> total 2, score 0.5
      row("tc-1", "passed", "2026-08-10T00:00:00Z"),
      row("tc-1", "failed", "2026-08-11T00:00:00Z"),
      // tc-2: 2 pass, 2 fail -> total 4, score 0.5 (same score, more runs)
      row("tc-2", "passed", "2026-08-10T00:00:00Z"),
      row("tc-2", "failed", "2026-08-11T00:00:00Z"),
      row("tc-2", "passed", "2026-08-12T00:00:00Z"),
      row("tc-2", "failed", "2026-08-13T00:00:00Z"),
    ];
    const result = computeFlakyTests(rows, { minExecutions: 2 });
    expect(result.map((r) => r.testCaseId)).toEqual(["tc-2", "tc-1"]);
  });

  it("applies limit after sorting, not before", () => {
    const rows = [
      // tc-1: 4 pass, 1 fail -> score 0.2 (low)
      row("tc-1", "passed", "2026-08-10T00:00:00Z"),
      row("tc-1", "passed", "2026-08-11T00:00:00Z"),
      row("tc-1", "passed", "2026-08-12T00:00:00Z"),
      row("tc-1", "passed", "2026-08-13T00:00:00Z"),
      row("tc-1", "failed", "2026-08-14T00:00:00Z"),
      // tc-2: 1 pass, 1 fail -> score 0.5 (higher — must win with limit: 1
      // even though it's inserted second and a Map would otherwise preserve
      // tc-1's insertion order)
      row("tc-2", "passed", "2026-08-10T00:00:00Z"),
      row("tc-2", "failed", "2026-08-11T00:00:00Z"),
    ];
    const result = computeFlakyTests(rows, { limit: 1, minExecutions: 2 });
    expect(result).toHaveLength(1);
    expect(result[0].testCaseId).toBe("tc-2");
  });
});
