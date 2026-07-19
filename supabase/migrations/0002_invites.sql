-- Lightweight team invites: an admin invites by email; the row is claimed
-- automatically the next time a user with a matching email signs in.

create table organization_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  role org_role not null default 'member',
  invited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (org_id, email)
);

alter table organization_invites enable row level security;

create policy "admins can view invites" on organization_invites
  for select using (is_org_admin(org_id));
create policy "admins can create invites" on organization_invites
  for insert with check (is_org_admin(org_id) and invited_by = auth.uid());
create policy "admins can delete invites" on organization_invites
  for delete using (is_org_admin(org_id));

-- Allow the invited user to read (and claim) their own pending invites by email,
-- and to remove the invite once claimed via the app layer.
create policy "invitee can view own invites by email" on organization_invites
  for select using (lower(email) = lower((select email from auth.users where id = auth.uid())));
create policy "invitee can delete own claimed invite" on organization_invites
  for delete using (lower(email) = lower((select email from auth.users where id = auth.uid())));

-- Let an invitee insert themselves as a member of the org that invited them,
-- at exactly the role they were invited at (not one they choose themselves).
create policy "invitee can self-join via invite" on organization_members
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from organization_invites
      where organization_invites.org_id = organization_members.org_id
        and lower(organization_invites.email) = lower((select email from auth.users where id = auth.uid()))
        and organization_invites.role = organization_members.role
    )
  );
