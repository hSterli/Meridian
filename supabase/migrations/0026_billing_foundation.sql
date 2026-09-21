-- Billing Foundation: trial state on organizations, plus an audit trail.
-- Trial expiry is never a stored transition (see design spec scope decision
-- 1) — billing_status stays 'trial' for the whole 14 days and beyond;
-- every read compares trial_end_date to now() to decide if the trial has
-- actually lapsed. The other three billing_status values, and most of
-- billing_event_type, aren't written by anything yet — they're declared now
-- because Postgres enum values are awkward to add later and the eventual
-- state machine is already known (see spec scope decisions 2-3).

create type billing_status as enum ('trial', 'active', 'past_due', 'cancelled');
create type billing_plan_type as enum ('monthly', 'annual');
create type billing_event_type as enum (
  'trial_started',
  'upgrade_started',
  'subscription_created',
  'subscription_renewed',
  'invoice_issued',
  'payment_succeeded',
  'payment_failed',
  'seat_added_mid_year',
  'plan_changed',
  'subscription_cancelled'
);

alter table organizations
  add column billing_status billing_status not null default 'trial',
  add column trial_end_date timestamptz,
  add column plan_type billing_plan_type;

create table billing_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  event_type billing_event_type not null,
  created_at timestamptz not null default now()
);

create index billing_events_org_id_idx on billing_events(org_id);

alter table billing_events enable row level security;

create policy "org members can view their org's billing events"
  on billing_events for select
  using (private.is_org_member(org_id));

-- Replaces the function from 0005_create_org_rpc.sql — same signature, same
-- RLS-bootstrapping trick (org + owner membership created atomically in one
-- SECURITY DEFINER call), now also setting trial_end_date and logging the
-- first billing event in the same transaction.
create or replace function create_organization_with_owner(org_name text, org_slug text)
returns organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org organizations;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  insert into organizations (name, slug, created_by, trial_end_date)
  values (org_name, org_slug, auth.uid(), now() + interval '14 days')
  returning * into v_org;

  insert into organization_members (org_id, user_id, role)
  values (v_org.id, auth.uid(), 'owner');

  insert into billing_events (org_id, event_type)
  values (v_org.id, 'trial_started');

  return v_org;
end;
$$;
