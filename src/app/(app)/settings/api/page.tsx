import { redirect } from "next/navigation";
import { getUserContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ApiKeyManager } from "@/components/settings/api-key-manager";
import { createApiKey, revokeApiKey } from "@/lib/actions/api-keys";

export default async function ApiSettingsPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect("/login");
  if (!ctx.activeOrgId) redirect("/onboarding");

  const isAdmin = ctx.activeRole === "owner" || ctx.activeRole === "admin";
  const supabase = await createClient();

  const { data: keys } = await supabase
    .from("api_keys")
    .select("id, name, created_at, last_used_at, revoked_at")
    .eq("org_id", ctx.activeOrgId)
    .order("created_at", { ascending: false });

  const createAction = createApiKey.bind(null, ctx.activeOrgId);
  const revokeAction = revokeApiKey.bind(null, ctx.activeOrgId);

  return (
    <div className="max-w-3xl px-6 py-8">
      <Breadcrumbs items={[{ label: "Settings", href: "/settings" }, { label: "API Keys" }]} />
      <PageHeader
        title="API Keys"
        description="Use these to authenticate requests to the Meridian API."
      />
      <ApiKeyManager
        keys={keys ?? []}
        isAdmin={isAdmin}
        createAction={createAction}
        revokeAction={revokeAction}
      />
    </div>
  );
}
