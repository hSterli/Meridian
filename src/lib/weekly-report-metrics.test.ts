import { describe, expect, it } from "vitest";
import { aggregateWeeklyMetrics, getWeekdayRange } from "./weekly-report-metrics";

describe("getWeekdayRange", () => {
  it("returns Monday through Friday of the week containing the given date", () => {
    // 2026-08-05 is a Wednesday
    expect(getWeekdayRange(new Date("2026-08-05T12:00:00Z"))).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
    ]);
  });

  it("returns the same week for a Monday as for the Friday of that week", () => {
    expect(getWeekdayRange(new Date("2026-08-03T12:00:00Z"))).toEqual(
      getWeekdayRange(new Date("2026-08-07T12:00:00Z"))
    );
  });

  it("rolls a Sunday forward to the following week's Monday-Friday", () => {
    // 2026-08-09 is a Sunday
    expect(getWeekdayRange(new Date("2026-08-09T12:00:00Z"))[0]).toBe("2026-08-10");
  });
});

describe("aggregateWeeklyMetrics", () => {
  const weekDates = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"];

  it("handles a project with no test cases at all", () => {
    const result = aggregateWeeklyMetrics({
      testCases: [],
      runCases: [],
      openDefects: 0,
      criticalHighOpen: 0,
      weekDates,
      plannedByDate: {},
    });
    expect(result.totalTestCases).toBe(0);
    expect(result.executed).toBe(0);
    expect(result.percentComplete).toBe(0);
    expect(result.passRate).toBe(0);
    expect(result.moduleBreakdown).toEqual([]);
    expect(result.dailyExecution).toHaveLength(5);
    expect(result.dailyExecution[0]).toEqual({
      date: "2026-08-03",
      planned: 0,
      actual: 0,
      passed: 0,
      failed: 0,
      blocked: 0,
    });
  });

  it("counts total and executed test cases, and computes pass rate from the latest status per case", () => {
    const result = aggregateWeeklyMetrics({
      testCases: [
        { id: "tc-1", featureName: "Login" },
        { id: "tc-2", featureName: "Login" },
        { id: "tc-3", featureName: "Checkout" },
      ],
      runCases: [
        { testCaseId: "tc-1", status: "passed", executedAt: "2026-08-04T10:00:00Z" },
        { testCaseId: "tc-2", status: "failed", executedAt: "2026-08-05T10:00:00Z" },
        // tc-3 has never been executed
      ],
      openDefects: 0,
      criticalHighOpen: 0,
      weekDates,
      plannedByDate: {},
    });
    expect(result.totalTestCases).toBe(3);
    expect(result.executed).toBe(2);
    expect(result.percentComplete).toBeCloseTo(2 / 3);
    expect(result.passRate).toBeCloseTo(1 / 2);
  });

  it("uses only the most recent execution per test case, not every attempt", () => {
    const result = aggregateWeeklyMetrics({
      testCases: [{ id: "tc-1", featureName: "Login" }],
      runCases: [
        { testCaseId: "tc-1", status: "failed", executedAt: "2026-08-03T09:00:00Z" },
        { testCaseId: "tc-1", status: "passed", executedAt: "2026-08-05T09:00:00Z" },
      ],
      openDefects: 0,
      criticalHighOpen: 0,
      weekDates,
      plannedByDate: {},
    });
    expect(result.executed).toBe(1);
    expect(result.passRate).toBe(1);
    const login = result.moduleBreakdown.find((m) => m.feature === "Login");
    expect(login?.passed).toBe(1);
    expect(login?.failed).toBe(0);
  });

  it("groups the module breakdown by feature, bucketing null feature as Unassigned", () => {
    const result = aggregateWeeklyMetrics({
      testCases: [
        { id: "tc-1", featureName: "Login" },
        { id: "tc-2", featureName: null },
      ],
      runCases: [
        { testCaseId: "tc-1", status: "passed", executedAt: "2026-08-04T10:00:00Z" },
        { testCaseId: "tc-2", status: "blocked", executedAt: "2026-08-04T10:00:00Z" },
      ],
      openDefects: 0,
      criticalHighOpen: 0,
      weekDates,
      plannedByDate: {},
    });
    const unassigned = result.moduleBreakdown.find((m) => m.feature === "Unassigned");
    expect(unassigned?.total).toBe(1);
    expect(unassigned?.blocked).toBe(1);
  });

  it("buckets every execution event within the week by its own date, even repeat runs of the same case", () => {
    const result = aggregateWeeklyMetrics({
      testCases: [{ id: "tc-1", featureName: "Login" }],
      runCases: [
        { testCaseId: "tc-1", status: "failed", executedAt: "2026-08-03T09:00:00Z" },
        { testCaseId: "tc-1", status: "passed", executedAt: "2026-08-04T09:00:00Z" },
      ],
      openDefects: 0,
      criticalHighOpen: 0,
      weekDates,
      plannedByDate: { "2026-08-03": 5, "2026-08-04": 5 },
    });
    const mon = result.dailyExecution.find((d) => d.date === "2026-08-03");
    const tue = result.dailyExecution.find((d) => d.date === "2026-08-04");
    expect(mon).toEqual({ date: "2026-08-03", planned: 5, actual: 1, passed: 0, failed: 1, blocked: 0 });
    expect(tue).toEqual({ date: "2026-08-04", planned: 5, actual: 1, passed: 1, failed: 0, blocked: 0 });
  });

  it("ignores executions outside the given week when building the daily table", () => {
    const result = aggregateWeeklyMetrics({
      testCases: [{ id: "tc-1", featureName: "Login" }],
      runCases: [{ testCaseId: "tc-1", status: "passed", executedAt: "2026-07-20T09:00:00Z" }],
      openDefects: 0,
      criticalHighOpen: 0,
      weekDates,
      plannedByDate: {},
    });
    expect(result.dailyExecution.every((d) => d.actual === 0)).toBe(true);
    // still counts toward the cumulative totals, since those aren't week-scoped
    expect(result.executed).toBe(1);
  });

  it("passes open defect counts through unchanged", () => {
    const result = aggregateWeeklyMetrics({
      testCases: [],
      runCases: [],
      openDefects: 11,
      criticalHighOpen: 1,
      weekDates,
      plannedByDate: {},
    });
    expect(result.openDefects).toBe(11);
    expect(result.criticalHighOpen).toBe(1);
  });
});
