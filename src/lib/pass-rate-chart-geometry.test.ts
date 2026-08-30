import { describe, expect, it } from "vitest";
import { buildAreaChartPath } from "./pass-rate-chart-geometry";
import type { DailyPassRate } from "./pass-rate-trend";

function entry(date: string, passRate: number): DailyPassRate {
  return { date, passed: 0, failed: 0, passRate };
}

describe("buildAreaChartPath", () => {
  it("returns empty strings for no entries", () => {
    expect(buildAreaChartPath([], 600, 150)).toEqual({ linePoints: "", areaPoints: "" });
  });

  it("draws a flat line across the full width for a single entry", () => {
    const result = buildAreaChartPath([entry("2026-08-10", 0.5)], 600, 150);
    expect(result.linePoints).toBe("0,75 600,75");
    expect(result.areaPoints).toBe("0,75 600,75 600,150 0,150");
  });

  it("places a 100% pass rate at the top (y=0) and 0% at the bottom (y=height)", () => {
    const result = buildAreaChartPath([entry("2026-08-10", 1), entry("2026-08-11", 0)], 600, 150);
    expect(result.linePoints).toBe("0,0 600,150");
  });

  it("spaces multiple points evenly across the width", () => {
    const result = buildAreaChartPath(
      [entry("2026-08-10", 1), entry("2026-08-11", 1), entry("2026-08-12", 1)],
      600,
      150
    );
    expect(result.linePoints).toBe("0,0 300,0 600,0");
  });

  it("closes the area polygon down to the baseline and back to the start", () => {
    const result = buildAreaChartPath([entry("2026-08-10", 1), entry("2026-08-11", 0)], 600, 150);
    expect(result.areaPoints).toBe("0,0 600,150 600,150 0,150");
  });
});
