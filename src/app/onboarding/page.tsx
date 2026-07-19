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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-slate-900">Set up your workspace</h1>
        <p className="mb-6 text-sm text-slate-500">
          One guided flow: create your team, then your first project.
        </p>
        <OnboardingWizard />
      </div>
    </div>
  );
}
