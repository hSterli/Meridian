import { describe, expect, it } from "vitest";
import { computeBlockedTests, type RawBlockedRunCaseRow } from "./blocked-tests";

// An overrides-object helper, not positional args like flaky-tests.test.ts's
// row() — RawBlockedRunCaseRow has 9 fields, more than reads cleanly
// positionally. Every test starts from this same "obviously blocked, obviously
// qualifies" baseline and overrides only what it's testing.
function row(overrides: Partial<RawBlockedRunCaseRow> = {}): RawBlockedRunCaseRow {
  return {
    testCaseId: "tc-1",
    title: "Test",
    projectId: "p-1",
    runId: "run-1",
    runName: "Run",
    runStatus: "in_progress",
    status: "blocked",
    executedAt: "2026-08-10T00:00:00Z",
    notes: null,
    ...overrides,
  };
}

describe("computeBlockedTests", () => {
  it("excludes a blocked row in a completed run", () => {
    expect(computeBlockedTests([row({ runStatus: "completed" })])).toEqual([]);
  });

  it("includes a blocked row in a planned or in_progress run", () => {
    const rows = [
      row({ runStatus: "planned" }),
      row({ testCaseId: "tc-2", runStatus: "in_progress" }),
    ];
    expect(computeBlockedTests(rows)).toHaveLength(2);
  });

  it("excludes non-blocked statuses regardless of run status", () => {
    const rows = [
      row({ status: "passed" }),
      row({ status: "failed" }),
      row({ status: "skipped" }),
      row({ status: "pending", executedAt: null }),
    ];
    expect(computeBlockedTests(rows)).toEqual([]);
  });

  it("sorts oldest-blocked first", () => {
    const rows = [
      row({ testCaseId: "tc-newer", executedAt: "2026-08-15T00:00:00Z" }),
      row({ testCaseId: "tc-older", executedAt: "2026-08-01T00:00:00Z" }),
    ];
    const result = computeBlockedTests(rows);
    expect(result.map((r) => r.testCaseId)).toEqual(["tc-older", "tc-newer"]);
  });

  it("passes a null notes value through unchanged", () => {
    const result = computeBlockedTests([row({ notes: null })]);
    expect(result[0].notes).toBeNull();
  });

  it("renames executedAt to blockedSince", () => {
    const result = computeBlockedTests([row({ executedAt: "2026-08-05T12:00:00Z" })]);
    expect(result[0].blockedSince).toBe("2026-08-05T12:00:00Z");
  });
});
