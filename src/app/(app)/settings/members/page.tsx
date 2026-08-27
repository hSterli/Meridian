import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/org-context";
import { Card, Badge } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { InviteForm } from "@/components/members/invite-form";
import { updateMemberRole, removeMember, cancelInvite } from "@/lib/actions/members";
import type { OrgRole } from "@/lib/types/database";

export default async function MembersPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrgId) redirect("/onboarding");

  const supabase = await createClient();
  const isAdmin = ctx.activeRole === "owner" || ctx.activeRole === "admin";

  const { data: members } = await supabase.rpc("get_org_members", {
    check_org_id: ctx.activeOrgId,
  });

  const { data: invites } = isAdmin
    ? await supabase
        .from("organization_invites")
        .select("id, email, role")
        .eq("org_id", ctx.activeOrgId)
    : { data: [] };

  return (
    <div className="max-w-3xl px-6 py-8">
      <Breadcrumbs items={[{ label: "Settings", href: "/settings" }, { label: "Team" }]} />
      <PageHeader title="Team" description="Roles configurable in minutes — owner, admin, or member." />

      {isAdmin && (
        <Card className="mb-6 p-4">
          <InviteForm />
        </Card>
      )}

      <Card className="divide-y divide-border-light">
        {(members ?? []).map((m: { user_id: string; email: string; role: OrgRole }) => (
          <div key={m.user_id} className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-ink-primary">{m.email}</span>
            <div className="flex items-center gap-2">
              {isAdmin && m.role !== "owner" ? (
                <>
                  <Badge tone="indigo">{m.role}</Badge>
                  <form action={updateMemberRole.bind(null, ctx.activeOrgId!, m.user_id, "admin" as OrgRole)}>
                    <Button type="submit" variant="secondary" disabled={m.role === "admin"}>
                      Make admin
                    </Button>
                  </form>
                  <form action={updateMemberRole.bind(null, ctx.activeOrgId!, m.user_id, "member" as OrgRole)}>
                    <Button type="submit" variant="secondary" disabled={m.role === "member"}>
                      Make member
                    </Button>
                  </form>
                  <form action={removeMember.bind(null, ctx.activeOrgId!, m.user_id)}>
                    <Button type="submit" variant="danger">
                      Remove
                    </Button>
                  </form>
                </>
              ) : (
                <Badge tone="indigo">{m.role}</Badge>
              )}
            </div>
          </div>
        ))}
      </Card>

      {isAdmin && (invites ?? []).length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-ink-secondary">Pending invites</h2>
          <Card className="divide-y divide-border-light">
            {(invites ?? []).map((inv: { id: string; email: string; role: OrgRole }) => (
              <div key={inv.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-ink-secondary">{inv.email}</span>
                <div className="flex items-center gap-2">
                  <Badge tone="slate">{inv.role}</Badge>
                  <form action={cancelInvite.bind(null, inv.id)}>
                    <Button type="submit" variant="ghost">
                      Cancel
                    </Button>
                  </form>
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}
