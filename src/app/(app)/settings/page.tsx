import Link from "next/link";
import { redirect } from "next/navigation";
import { Users, Building2, Plug, CreditCard, ChevronRight } from "lucide-react";
import { getUserContext } from "@/lib/org-context";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";

export default async function SettingsPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrgId) redirect("/onboarding");

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" />
      <Card className="divide-y divide-border-light">
        <Link
          href="/settings/members"
          className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-paper-surface"
        >
          <div className="rounded-lg bg-meridian-soft p-2 text-primary">
            <Users size={18} />
          </div>
          <div className="flex-1">
            <p className="font-ui-label font-semibold text-ink-primary">Team</p>
            <p className="text-sm text-ink-secondary">Manage members, roles, and invites.</p>
          </div>
          <ChevronRight size={18} className="text-ink-tertiary" />
        </Link>

        {[
          {
            icon: Building2,
            title: "Organization",
            description: "Name, slug, and workspace-wide defaults.",
          },
          {
            icon: Plug,
            title: "Integrations",
            description: "Jira, GitHub, GitLab, Slack, and CI runner connections.",
          },
          {
            icon: CreditCard,
            title: "Billing",
            description: "Plan, seats, and payment details.",
          },
        ].map((s) => (
          <div key={s.title} className="flex items-center gap-4 px-5 py-4 opacity-60">
            <div className="rounded-lg bg-surface-container-highest p-2 text-ink-tertiary">
              <s.icon size={18} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-ui-label font-semibold text-ink-primary">{s.title}</p>
                <span className="rounded-full bg-surface-container-highest px-2 py-0.5 text-[10px] font-ui-label font-bold uppercase tracking-wide text-ink-tertiary">
                  Coming soon
                </span>
              </div>
              <p className="text-sm text-ink-secondary">{s.description}</p>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
