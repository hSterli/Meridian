import { redirect } from "next/navigation";
import { BarChart3, GitBranch, Gauge, ShieldAlert } from "lucide-react";
import { getUserContext } from "@/lib/org-context";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";

const PLANNED_REPORTS = [
  {
    icon: BarChart3,
    title: "Pass/fail trend",
    description: "Cross-project pass rate over time, drillable by project or date range.",
  },
  {
    icon: GitBranch,
    title: "Coverage by requirement",
    description: "Traceability from requirements through test cases to run results.",
  },
  {
    icon: Gauge,
    title: "Team velocity",
    description: "Test cases authored and runs executed per team member, per sprint.",
  },
  {
    icon: ShieldAlert,
    title: "Flaky-test deep dive",
    description: "Full history for any test with mixed pass/fail results, not just the top 5.",
  },
];

export default async function ReportsPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrgId) redirect("/onboarding");

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Reports"
        description="The dashboard already covers cross-project pass/fail trend and the flaky-test tracker. Deeper, exportable report templates are coming next."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {PLANNED_REPORTS.map((r) => (
          <Card key={r.title} className="flex items-start gap-4 p-5 opacity-70">
            <div className="rounded-lg bg-meridian-soft p-2 text-primary">
              <r.icon size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-ui-label font-semibold text-ink-primary">{r.title}</p>
                <span className="rounded-full bg-surface-container-highest px-2 py-0.5 text-[10px] font-ui-label font-bold uppercase tracking-wide text-ink-tertiary">
                  Coming soon
                </span>
              </div>
              <p className="mt-1 text-sm text-ink-secondary">{r.description}</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
