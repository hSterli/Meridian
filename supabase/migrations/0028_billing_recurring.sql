alter table organizations
  add column next_billing_date timestamptz,
  add column payment_failed_since timestamptz;

-- Back-fill next_billing_date for any org already active from Phase 2's
-- one-time Checkout payment, so this phase's cron has something to compare
-- against for orgs that paid before this migration ran. An approximation
-- (there's no stored payment date to compute the *exact* next-due date
-- from) — acceptable since it only affects orgs that converted during the
-- narrow window between Phase 2 shipping and this migration running.
update organizations
set next_billing_date = case
  when plan_type = 'monthly' then now() + interval '1 month'
  when plan_type = 'annual' then now() + interval '1 year'
  else null
end
where billing_status = 'active' and next_billing_date is null;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- cron_app_url and cron_secret are read from Supabase Vault by name, not
-- embedded here — this file is committed to git, and a real secret checked
-- into source control defeats the point of having one. Neither Vault
-- secret is created by this migration; see the plan's Task 7 for that
-- manual, out-of-band step.
select cron.schedule(
  'billing-run-cycle',
  '0 6 * * *', -- daily, 6 AM UTC
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_app_url')
      || '/api/internal/billing/run-cycle',
    headers := jsonb_build_object(
      'x-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
