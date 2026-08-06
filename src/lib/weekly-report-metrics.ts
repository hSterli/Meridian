export interface RawTestCaseRow {
  id: string;
  featureName: string | null;
}

export type RunCaseStatusValue = "pending" | "passed" | "failed" | "blocked" | "skipped";

export interface RawRunCaseRow {
  testCaseId: string;
  status: RunCaseStatusValue;
  executedAt: string | null;
}

export interface DailyExecutionEntry {
  date: string;
  planned: number;
  actual: number;
  passed: number;
  failed: number;
  blocked: number;
}

export interface ModuleBreakdownEntry {
  feature: string;
  total: number;
  executed: number;
  passed: number;
  failed: number;
  blocked: number;
}

export interface WeeklyMetrics {
  totalTestCases: number;
  executed: number;
  percentComplete: number;
  passRate: number;
  openDefects: number;
  criticalHighOpen: number;
  dailyExecution: DailyExecutionEntry[];
  moduleBreakdown: ModuleBreakdownEntry[];
}

export interface AggregateWeeklyMetricsInput {
  testCases: RawTestCaseRow[];
  runCases: RawRunCaseRow[];
  openDefects: number;
  criticalHighOpen: number;
  weekDates: string[];
  plannedByDate: Record<string, number>;
}

const UNASSIGNED_FEATURE = "Unassigned";

function latestExecutedStatusByTestCase(
  runCases: RawRunCaseRow[]
): Map<string, RawRunCaseRow> {
  const latest = new Map<string, RawRunCaseRow>();
  for (const rc of runCases) {
    if (!rc.executedAt) continue;
    const existing = latest.get(rc.testCaseId);
    if (!existing || !existing.executedAt || rc.executedAt > existing.executedAt) {
      latest.set(rc.testCaseId, rc);
    }
  }
  return latest;
}

export function aggregateWeeklyMetrics(input: AggregateWeeklyMetricsInput): WeeklyMetrics {
  const { testCases, runCases, openDefects, criticalHighOpen, weekDates, plannedByDate } = input;

  const latestByTestCase = latestExecutedStatusByTestCase(runCases);
  const totalTestCases = testCases.length;
  const executed = latestByTestCase.size;
  const passed = Array.from(latestByTestCase.values()).filter((rc) => rc.status === "passed").length;

  const moduleMap = new Map<string, ModuleBreakdownEntry>();
  for (const tc of testCases) {
    const feature = tc.featureName ?? UNASSIGNED_FEATURE;
    if (!moduleMap.has(feature)) {
      moduleMap.set(feature, { feature, total: 0, executed: 0, passed: 0, failed: 0, blocked: 0 });
    }
    const entry = moduleMap.get(feature)!;
    entry.total += 1;
    const latest = latestByTestCase.get(tc.id);
    if (latest) {
      entry.executed += 1;
      if (latest.status === "passed") entry.passed += 1;
      if (latest.status === "failed") entry.failed += 1;
      if (latest.status === "blocked") entry.blocked += 1;
    }
  }

  const dailyExecution: DailyExecutionEntry[] = weekDates.map((date) => {
    const dayRunCases = runCases.filter((rc) => rc.executedAt && rc.executedAt.slice(0, 10) === date);
    return {
      date,
      planned: plannedByDate[date] ?? 0,
      actual: dayRunCases.length,
      passed: dayRunCases.filter((rc) => rc.status === "passed").length,
      failed: dayRunCases.filter((rc) => rc.status === "failed").length,
      blocked: dayRunCases.filter((rc) => rc.status === "blocked").length,
    };
  });

  return {
    totalTestCases,
    executed,
    percentComplete: totalTestCases === 0 ? 0 : executed / totalTestCases,
    passRate: executed === 0 ? 0 : passed / executed,
    openDefects,
    criticalHighOpen,
    dailyExecution,
    moduleBreakdown: Array.from(moduleMap.values()),
  };
}

export function getWeekdayRange(referenceDate: Date): string[] {
  const day = referenceDate.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
  const diffToMonday = day === 0 ? 1 : 1 - day;
  const monday = new Date(referenceDate);
  monday.setUTCDate(referenceDate.getUTCDate() + diffToMonday);
  monday.setUTCHours(0, 0, 0, 0);

  const dates: string[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}
