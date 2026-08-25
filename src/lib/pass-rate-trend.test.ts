import { describe, expect, it } from "vitest";
import { computePassRateTrend, type RawTrendRunCaseRow } from "./pass-rate-trend";

function row(status: RawTrendRunCaseRow["status"], executedAt: string | null): RawTrendRunCaseRow {
  return { status, executedAt };
}

describe("computePassRateTrend", () => {
  it("scores a day with only passed rows as 1.0", () => {
    const rows = [row("passed", "2026-08-10T09:00:00Z"), row("passed", "2026-08-10T14:00:00Z")];
    expect(computePassRateTrend(rows)).toEqual([
      { date: "2026-08-10", passed: 2, failed: 0, passRate: 1 },
    ]);
  });

  it("scores a day with only failed rows as 0", () => {
    const rows = [row("failed", "2026-08-11T09:00:00Z")];
    expect(computePassRateTrend(rows)).toEqual([
      { date: "2026-08-11", passed: 0, failed: 1, passRate: 0 },
    ]);
  });

  it("omits a day whose only rows are blocked/skipped/pending, rather than scoring it 0", () => {
    const rows = [
      row("blocked", "2026-08-12T09:00:00Z"),
      row("skipped", "2026-08-12T10:00:00Z"),
      row("pending", null),
    ];
    expect(computePassRateTrend(rows)).toEqual([]);
  });

  it("groups multiple rows on the same UTC date into one entry", () => {
    const rows = [row("passed", "2026-08-13T00:30:00Z"), row("failed", "2026-08-13T23:30:00Z")];
    expect(computePassRateTrend(rows)).toEqual([
      { date: "2026-08-13", passed: 1, failed: 1, passRate: 0.5 },
    ]);
  });

  it("sorts entries ascending by date", () => {
    const rows = [
      row("passed", "2026-08-15T00:00:00Z"),
      row("passed", "2026-08-11T00:00:00Z"),
      row("passed", "2026-08-13T00:00:00Z"),
    ];
    const result = computePassRateTrend(rows);
    expect(result.map((r) => r.date)).toEqual(["2026-08-11", "2026-08-13", "2026-08-15"]);
  });

  it("trims to the most recent `days` distinct dates when more are present", () => {
    const rows = [
      row("passed", "2026-08-01T00:00:00Z"),
      row("passed", "2026-08-02T00:00:00Z"),
      row("passed", "2026-08-03T00:00:00Z"),
    ];
    const result = computePassRateTrend(rows, 2);
    expect(result.map((r) => r.date)).toEqual(["2026-08-02", "2026-08-03"]);
  });
});
