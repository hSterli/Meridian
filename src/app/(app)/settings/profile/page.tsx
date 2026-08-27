import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/org-context";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { ProfileForm } from "@/components/settings/profile-form";

export default async function ProfileSettingsPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrgId) redirect("/onboarding");

  return (
    <div className="max-w-2xl px-6 py-8">
      <PageHeader title="Profile" description="Your name and account email." />
      <Card className="p-5">
        <ProfileForm fullName={ctx.fullName} email={ctx.email} />
      </Card>
    </div>
  );
}
