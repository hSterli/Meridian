import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { getUserContext } from "@/lib/org-context";
import { acceptPendingInvites } from "@/lib/actions/members";

export default async function OnboardingPage() {
  let ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (ctx.memberships.length === 0) {
    await acceptPendingInvites();
    ctx = await getUserContext();
  }
  if (!ctx) redirect("/login");
  if (ctx.memberships.length > 0) redirect("/dashboard");

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper-surface px-4">
      <div className="w-full max-w-md rounded-xl border border-border-light bg-white p-8 shadow-sm">
        <h1 className="font-headline-md mb-1 text-[22px] font-semibold text-ink-primary">
          Set up your workspace
        </h1>
        <p className="mb-6 text-sm text-ink-secondary">
          One guided flow: create your team, then your first project.
        </p>
        <OnboardingWizard />
      </div>
    </div>
  );
}
