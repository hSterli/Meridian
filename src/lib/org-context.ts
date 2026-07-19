import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { OrgRole } from "@/lib/types/database";

const ACTIVE_ORG_COOKIE = "meridian_active_org";

export interface OrgMembership {
  org_id: string;
  role: OrgRole;
  organizations: { id: string; name: string; slug: string };
}

export interface UserContext {
  userId: string;
  email: string | null;
  memberships: OrgMembership[];
  activeOrgId: string | null;
  activeRole: OrgRole | null;
}

export async function getUserContext(): Promise<UserContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: memberships } = await supabase
    .from("organization_members")
    .select("org_id, role, organizations(id, name, slug)")
    .eq("user_id", user.id);

  const typedMemberships = (memberships ?? []) as unknown as OrgMembership[];

  const cookieStore = await cookies();
  const cookieOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value ?? null;

  const active =
    typedMemberships.find((m) => m.org_id === cookieOrgId) ?? typedMemberships[0] ?? null;

  return {
    userId: user.id,
    email: user.email ?? null,
    memberships: typedMemberships,
    activeOrgId: active?.org_id ?? null,
    activeRole: active?.role ?? null,
  };
}

export { ACTIVE_ORG_COOKIE };
