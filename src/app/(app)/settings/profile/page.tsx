import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/org-context";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ProfileForm } from "@/components/settings/profile-form";

export default async function ProfileSettingsPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrgId) redirect("/onboarding");

  return (
    <div className="max-w-3xl">
      <Breadcrumbs items={[{ label: "Settings", href: "/settings" }, { label: "Profile" }]} />
      <PageHeader title="Profile" description="Your name and account email." />
      <Card className="p-5">
        <ProfileForm fullName={ctx.fullName} email={ctx.email} />
      </Card>
    </div>
  );
}
