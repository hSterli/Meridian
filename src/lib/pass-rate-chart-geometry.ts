import type { DailyPassRate } from "./pass-rate-trend";

export interface AreaChartPaths {
  linePoints: string;
  areaPoints: string;
}

// Pure — converts a list of daily pass rates into SVG <polyline>/<polygon>
// `points` attribute strings, plotted left-to-right (oldest to newest,
// since computePassRateTrend already returns them sorted ascending).
// passRate 1 (100%) maps to y=0 (top); passRate 0 maps to y=height
// (bottom) — standard "up is good" chart orientation.
export function buildAreaChartPath(
  entries: DailyPassRate[],
  width: number,
  height: number
): AreaChartPaths {
  if (entries.length === 0) {
    return { linePoints: "", areaPoints: "" };
  }

  if (entries.length === 1) {
    const y = height - entries[0].passRate * height;
    const linePoints = `0,${y} ${width},${y}`;
    return { linePoints, areaPoints: `${linePoints} ${width},${height} 0,${height}` };
  }

  const stepX = width / (entries.length - 1);
  const linePoints = entries
    .map((e, i) => {
      const x = i * stepX;
      const y = height - e.passRate * height;
      return `${x},${y}`;
    })
    .join(" ");

  return { linePoints, areaPoints: `${linePoints} ${width},${height} 0,${height}` };
}
