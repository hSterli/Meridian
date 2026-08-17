import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { getUserContext } from "@/lib/org-context";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";

const PROVIDERS = [
  { segment: "jira", label: "Jira", description: "Two-way sync between Meridian issues and Jira." },
  {
    segment: "github",
    label: "GitHub",
    description: "Two-way issue sync and PR/MR test-result feedback, per project.",
  },
  {
    segment: "slack",
    label: "Slack",
    description: "Post a message when a CI-ingested test run completes.",
  },
];

export default async function IntegrationsIndexPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrgId) redirect("/onboarding");

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <PageHeader title="Integrations" description="Connect external issue trackers and CI tools." />
      <Card className="divide-y divide-border-light">
        {PROVIDERS.map((provider) => (
          <Link
            key={provider.segment}
            href={`/settings/integrations/${provider.segment}`}
            className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-paper-surface"
          >
            <div className="flex-1">
              <p className="font-ui-label font-semibold text-ink-primary">{provider.label}</p>
              <p className="text-sm text-ink-secondary">{provider.description}</p>
            </div>
            <ChevronRight size={18} className="text-ink-tertiary" />
          </Link>
        ))}
      </Card>
    </div>
  );
}
