-- Application-level rate limiting for expensive/abusable authenticated
-- mutations (invite emails, bulk test-case writes, CSV import). Login/signup
-- abuse is already covered by Supabase Auth's own built-in per-IP rate
-- limits (Dashboard -> Authentication -> Rate Limits), which run ahead of
-- our application code and can't be bypassed by it — no need to reimplement
-- that here.
--
-- Design note: the bucket key is always derived from auth.uid() *inside* the
-- function, never accepted as a caller-supplied identifier. If callers could
-- pass an arbitrary key (e.g. "login:someone@example.com"), any authenticated
-- (or worse, anon) caller could deliberately max out another user's bucket as
-- a denial-of-service. Scoping the key to the caller's own verified identity
-- makes that impossible — a user can only ever exhaust their own bucket.

create table rate_limit_buckets (
  key text primary key,
  count integer not null default 1,
  window_start timestamptz not null default now()
);

-- RLS with zero policies: only the SECURITY DEFINER function below (which
-- bypasses RLS as its owner) can ever touch this table.
alter table rate_limit_buckets enable row level security;

create or replace function check_rate_limit(p_action text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  v_key := auth.uid()::text || ':' || p_action;

  insert into rate_limit_buckets (key, count, window_start)
  values (v_key, 1, now())
  on conflict (key) do update
    set count = case
          when rate_limit_buckets.window_start < now() - make_interval(secs => p_window_seconds)
            then 1
          else rate_limit_buckets.count + 1
        end,
        window_start = case
          when rate_limit_buckets.window_start < now() - make_interval(secs => p_window_seconds)
            then now()
          else rate_limit_buckets.window_start
        end
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function check_rate_limit(text, integer, integer) from public, anon;
grant execute on function check_rate_limit(text, integer, integer) to authenticated;
