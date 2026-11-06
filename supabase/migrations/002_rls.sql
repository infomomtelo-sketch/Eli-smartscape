-- 002_rls.sql
-- Row Level Security. Every row is scoped by org_id; the caller's org and role come
-- from their profile (never from the client). Clients cannot set org_id: triggers
-- in 003_triggers.sql overwrite it on insert.

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER so policies do not recurse into profiles' own RLS)
-- ---------------------------------------------------------------------------
create or replace function public.app_org() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select org_id from public.profiles where user_id = auth.uid() and active
$$;

create or replace function public.app_role() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.profiles where user_id = auth.uid() and active
$$;

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.app_role() in ('manager', 'owner'), false)
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.orgs          enable row level security;
alter table public.profiles      enable row level security;
alter table public.invites       enable row level security;
alter table public.homes         enable row level security;
alter table public.routes        enable row level security;
alter table public.mileage_rates enable row level security;
alter table public.reports       enable row level security;
alter table public.trips         enable row level security;
alter table public.audit_log     enable row level security;

-- Anonymous (logged-out) callers get nothing.
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- orgs
-- ---------------------------------------------------------------------------
create policy orgs_select on public.orgs for select to authenticated
  using (id = public.app_org());
create policy orgs_update on public.orgs for update to authenticated
  using (id = public.app_org() and public.app_role() = 'owner')
  with check (id = public.app_org());

-- ---------------------------------------------------------------------------
-- profiles (rows are created only by create_org / claim_invite)
-- ---------------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (org_id = public.app_org());
create policy profiles_update on public.profiles for update to authenticated
  using (org_id = public.app_org() and public.app_role() = 'owner')
  with check (org_id = public.app_org());
revoke insert, delete on public.profiles from authenticated;

-- ---------------------------------------------------------------------------
-- invites (owner only)
-- ---------------------------------------------------------------------------
create policy invites_select on public.invites for select to authenticated
  using (org_id = public.app_org() and public.app_role() = 'owner');
create policy invites_insert on public.invites for insert to authenticated
  with check (org_id = public.app_org() and public.app_role() = 'owner');
create policy invites_delete on public.invites for delete to authenticated
  using (org_id = public.app_org() and public.app_role() = 'owner' and claimed_at is null);
revoke update on public.invites from authenticated;

-- ---------------------------------------------------------------------------
-- homes: everyone in the org reads; managers/owners edit; never deleted (deactivate)
-- ---------------------------------------------------------------------------
create policy homes_select on public.homes for select to authenticated
  using (org_id = public.app_org());
create policy homes_insert on public.homes for insert to authenticated
  with check (org_id = public.app_org() and public.is_manager());
create policy homes_update on public.homes for update to authenticated
  using (org_id = public.app_org() and public.is_manager())
  with check (org_id = public.app_org());
revoke delete on public.homes from authenticated;

-- ---------------------------------------------------------------------------
-- routes: any member saves a new pair; only managers/owners edit or remove
-- ---------------------------------------------------------------------------
create policy routes_select on public.routes for select to authenticated
  using (org_id = public.app_org());
create policy routes_insert on public.routes for insert to authenticated
  with check (org_id = public.app_org());
create policy routes_update on public.routes for update to authenticated
  using (org_id = public.app_org() and public.is_manager())
  with check (org_id = public.app_org());
create policy routes_delete on public.routes for delete to authenticated
  using (org_id = public.app_org() and public.is_manager());

-- ---------------------------------------------------------------------------
-- mileage_rates: everyone reads; owner edits
-- ---------------------------------------------------------------------------
create policy rates_select on public.mileage_rates for select to authenticated
  using (org_id = public.app_org());
create policy rates_insert on public.mileage_rates for insert to authenticated
  with check (org_id = public.app_org() and public.app_role() = 'owner');
create policy rates_update on public.mileage_rates for update to authenticated
  using (org_id = public.app_org() and public.app_role() = 'owner')
  with check (org_id = public.app_org());
create policy rates_delete on public.mileage_rates for delete to authenticated
  using (org_id = public.app_org() and public.app_role() = 'owner');

-- ---------------------------------------------------------------------------
-- reports: employees see their own; managers/owners see the org's.
-- Clients may only INSERT a draft. Every status change goes through the
-- sign_report / unsign_report / approve_report / mark_paid functions.
-- There is no UPDATE or DELETE policy, so signed reports can never be altered
-- or removed from the client.
-- ---------------------------------------------------------------------------
create policy reports_select on public.reports for select to authenticated
  using (org_id = public.app_org()
         and (user_id = auth.uid() or public.is_manager()));
create policy reports_insert on public.reports for insert to authenticated
  with check (org_id = public.app_org() and user_id = auth.uid() and status = 'draft');
revoke update, delete on public.reports from authenticated;

-- ---------------------------------------------------------------------------
-- trips: you only write your own, and only while the report is a draft
-- (the draft lock itself is enforced by a trigger).
-- ---------------------------------------------------------------------------
create policy trips_select on public.trips for select to authenticated
  using (org_id = public.app_org()
         and (user_id = auth.uid() or public.is_manager()));
create policy trips_insert on public.trips for insert to authenticated
  with check (org_id = public.app_org() and user_id = auth.uid());
create policy trips_update on public.trips for update to authenticated
  using (org_id = public.app_org() and user_id = auth.uid())
  with check (org_id = public.app_org() and user_id = auth.uid());
create policy trips_delete on public.trips for delete to authenticated
  using (org_id = public.app_org() and user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- audit_log: read-only for clients (written by triggers)
-- ---------------------------------------------------------------------------
create policy audit_select on public.audit_log for select to authenticated
  using (org_id = public.app_org()
         and (public.is_manager()
              or exists (select 1 from public.reports r
                         where r.id = audit_log.report_id and r.user_id = auth.uid())));
revoke insert, update, delete on public.audit_log from authenticated;
