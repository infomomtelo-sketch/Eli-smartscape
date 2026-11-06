-- 003_triggers.sql
-- Integrity rules (trip pricing, month lock, status flow, audit, no deletes)
-- and the functions the app calls for onboarding and report status changes.

-- ---------------------------------------------------------------------------
-- org_id is never trusted from the client
-- ---------------------------------------------------------------------------
create or replace function public.tg_set_org() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.org_id := coalesce(public.app_org(), new.org_id);
  elsif new.org_id is distinct from old.org_id then
    raise exception 'org_id cannot be changed';
  end if;
  return new;
end $$;

create trigger set_org before insert or update on public.homes
  for each row execute function public.tg_set_org();
create trigger set_org before insert or update on public.routes
  for each row execute function public.tg_set_org();
create trigger set_org before insert or update on public.mileage_rates
  for each row execute function public.tg_set_org();
create trigger set_org before insert or update on public.invites
  for each row execute function public.tg_set_org();
create trigger set_org before insert or update on public.reports
  for each row execute function public.tg_set_org();
create trigger set_org before insert or update on public.profiles
  for each row execute function public.tg_set_org();

-- ---------------------------------------------------------------------------
-- invites: normalise email
-- ---------------------------------------------------------------------------
create or replace function public.tg_invites_email() returns trigger
language plpgsql as $$
begin
  new.email := lower(trim(new.email));
  return new;
end $$;
create trigger invites_email before insert or update on public.invites
  for each row execute function public.tg_invites_email();

-- ---------------------------------------------------------------------------
-- routes: store each pair in a fixed order so A->B and B->A are one route
-- ---------------------------------------------------------------------------
create or replace function public.tg_routes_order() returns trigger
language plpgsql as $$
declare k text; l text;
begin
  if tg_op = 'INSERT' and new.created_by is null then
    new.created_by := auth.uid();
  end if;
  if new.a_key > new.b_key then
    k := new.a_key; l := new.a_label;
    new.a_key := new.b_key; new.a_label := new.b_label;
    new.b_key := k;        new.b_label := l;
  end if;
  return new;
end $$;
create trigger routes_order before insert or update on public.routes
  for each row execute function public.tg_routes_order();

-- ---------------------------------------------------------------------------
-- profiles: identity fields are fixed; an org must always keep an active owner
-- ---------------------------------------------------------------------------
create or replace function public.tg_profiles_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.user_id <> old.user_id then
    raise exception 'user_id cannot be changed';
  end if;
  if old.role = 'owner' and old.active and (new.role <> 'owner' or not new.active) then
    if not exists (select 1 from public.profiles
                   where org_id = old.org_id and role = 'owner' and active
                     and user_id <> old.user_id) then
      raise exception 'An organization must keep at least one active owner';
    end if;
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.tg_profiles_guard();

-- ---------------------------------------------------------------------------
-- trips: month lock + automatic pricing from the rate table
-- ---------------------------------------------------------------------------
create or replace function public.tg_trips_write() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.reports;
  v_rate numeric;
begin
  select * into r from public.reports
   where id = case when tg_op = 'DELETE' then old.report_id else new.report_id end;
  if not found then
    raise exception 'Report not found';
  end if;
  if r.status <> 'draft' then
    raise exception 'This month is % and its trips are locked', r.status;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if tg_op = 'UPDATE' and new.report_id <> old.report_id then
    raise exception 'A trip cannot be moved to another report';
  end if;

  new.org_id  := r.org_id;
  new.user_id := r.user_id;

  if new.trip_date < r.month or new.trip_date >= (r.month + interval '1 month')::date then
    raise exception 'Trip date % is outside the report month %', new.trip_date, r.month;
  end if;

  -- The rate that applies is the one effective on the trip date.
  select rate_per_mile into v_rate
    from public.mileage_rates
   where org_id = r.org_id and effective_date <= new.trip_date
   order by effective_date desc limit 1;
  if v_rate is null then
    raise exception 'No mileage rate is in effect on %', new.trip_date;
  end if;

  new.rate_applied := v_rate;
  new.amount := round(new.miles * v_rate, 2);
  return new;
end $$;
create trigger trips_write before insert or update or delete on public.trips
  for each row execute function public.tg_trips_write();

-- ---------------------------------------------------------------------------
-- reports: drafts only on insert; legal status flow; frozen once signed; no deletes
-- ---------------------------------------------------------------------------
create or replace function public.tg_reports_insert() returns trigger
language plpgsql as $$
begin
  new.status := 'draft';
  new.signed_name := null; new.signed_at := null;
  new.snapshot := null; new.snapshot_hash := null;
  new.approved_by := null; new.approved_at := null;
  new.paid_date := null; new.payment_method := null;
  return new;
end $$;
create trigger reports_insert before insert on public.reports
  for each row execute function public.tg_reports_insert();

create or replace function public.tg_reports_guard() returns trigger
language plpgsql as $$
begin
  if new.user_id <> old.user_id or new.month <> old.month or new.org_id <> old.org_id then
    raise exception 'Report owner, month and organization cannot be changed';
  end if;

  if new.status <> old.status
     and not ((old.status, new.status) in
              (('draft', 'signed'), ('signed', 'draft'),
               ('signed', 'approved'), ('approved', 'paid'))) then
    raise exception 'Illegal status change % -> %', old.status, new.status;
  end if;

  -- Once signed, the frozen copy and signature cannot change except by unsigning.
  if old.status <> 'draft' and new.status <> 'draft' and (
       new.snapshot is distinct from old.snapshot
    or new.snapshot_hash is distinct from old.snapshot_hash
    or new.signed_name is distinct from old.signed_name
    or new.signed_at is distinct from old.signed_at) then
    raise exception 'A signed report cannot be modified';
  end if;
  return new;
end $$;
create trigger reports_guard before update on public.reports
  for each row execute function public.tg_reports_guard();

create or replace function public.tg_block_delete() returns trigger
language plpgsql as $$
begin
  raise exception '% rows cannot be deleted', tg_table_name;
end $$;
create trigger reports_no_delete before delete on public.reports
  for each row execute function public.tg_block_delete();

-- ---------------------------------------------------------------------------
-- audit_log: written by trigger, append-only
-- ---------------------------------------------------------------------------
create or replace function public.tg_reports_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (org_id, report_id, actor_id, action, to_status)
    values (new.org_id, new.id, auth.uid(), 'created', new.status);
  elsif new.status is distinct from old.status then
    insert into public.audit_log (org_id, report_id, actor_id, action, from_status, to_status, detail)
    values (new.org_id, new.id, auth.uid(),
            case new.status
              when 'signed' then 'signed'
              when 'approved' then 'approved'
              when 'paid' then 'paid'
              else 'unsigned' end,
            old.status, new.status,
            jsonb_build_object(
              'signed_name', coalesce(new.signed_name, old.signed_name),
              'snapshot_hash', coalesce(new.snapshot_hash, old.snapshot_hash),
              'approved_by', new.approved_by,
              'paid_date', new.paid_date,
              'payment_method', new.payment_method));
  end if;
  return null;
end $$;
create trigger reports_audit after insert or update on public.reports
  for each row execute function public.tg_reports_audit();

create trigger audit_log_immutable before update or delete on public.audit_log
  for each row execute function public.tg_block_delete();

-- ===========================================================================
-- Functions the app calls (all run as the table owner but check the caller)
-- ===========================================================================

-- First login, no invite: create a new organization and become its owner.
-- Seeds the org's rate table (IRS business rate): 2026-01-01 = 0.725, 2026-07-01 = 0.76.
create or replace function public.create_org(p_org_name text, p_full_name text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from public.profiles where user_id = auth.uid()) then
    raise exception 'You already belong to an organization';
  end if;
  insert into public.orgs (name) values (trim(p_org_name)) returning id into v_org;
  insert into public.profiles (user_id, org_id, full_name, role)
  values (auth.uid(), v_org, trim(p_full_name), 'owner');
  insert into public.mileage_rates (org_id, effective_date, rate_per_mile) values
    (v_org, date '2026-01-01', 0.725),
    (v_org, date '2026-07-01', 0.76);
  return v_org;
end $$;

-- First login with an invite: join the inviting organization.
create or replace function public.claim_invite(p_full_name text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  i public.invites;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_name text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from public.profiles where user_id = auth.uid()) then
    raise exception 'You already belong to an organization';
  end if;
  select * into i from public.invites
   where email = v_email and claimed_at is null
   order by created_at desc limit 1
   for update;
  if not found then raise exception 'No invitation found for this email'; end if;
  v_name := coalesce(nullif(trim(coalesce(p_full_name, '')), ''), i.full_name);
  if v_name is null then raise exception 'Full name is required'; end if;
  insert into public.profiles (user_id, org_id, full_name, role)
  values (auth.uid(), i.org_id, v_name, i.role);
  update public.invites set claimed_at = now() where id = i.id;
  return i.org_id;
end $$;

-- Employee signs their own draft report. Re-prices every trip, freezes a snapshot.
create or replace function public.sign_report(p_report uuid, p_name text)
returns public.reports
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.reports;
  v_name text := trim(coalesce(p_name, ''));
  v_emp text;
  v_now timestamptz := now();
  snap jsonb;
begin
  select * into r from public.reports where id = p_report for update;
  if not found or r.user_id is distinct from auth.uid() then
    raise exception 'Report not found';
  end if;
  if r.status <> 'draft' then raise exception 'Report is already %', r.status; end if;
  if length(v_name) < 2 then raise exception 'Type your full name to sign'; end if;
  if not exists (select 1 from public.trips where report_id = r.id) then
    raise exception 'Cannot sign a report with no trips';
  end if;

  -- Re-run pricing so the signed amounts use the rate table as it stands now.
  update public.trips set miles = miles where report_id = r.id;

  select full_name into v_emp from public.profiles where user_id = r.user_id;

  snap := jsonb_build_object(
    'employee_name', v_emp,
    'month', r.month,
    'signed_name', v_name,
    'signed_at', v_now,
    'trips', (select jsonb_agg(jsonb_build_object(
                'date', trip_date, 'from', from_label, 'to', to_label,
                'purpose', purpose, 'miles', miles,
                'rate', rate_applied, 'amount', amount)
                order by trip_date, created_at, id)
              from public.trips where report_id = r.id),
    'total_miles',  (select sum(miles)  from public.trips where report_id = r.id),
    'total_amount', (select sum(amount) from public.trips where report_id = r.id),
    'rate_breakdown', (select jsonb_agg(jsonb_build_object(
                'rate', rate_applied, 'miles', m, 'amount', a) order by rate_applied)
              from (select rate_applied, sum(miles) m, sum(amount) a
                      from public.trips where report_id = r.id
                     group by rate_applied) x));

  update public.reports
     set status = 'signed', signed_name = v_name, signed_at = v_now,
         snapshot = snap,
         snapshot_hash = encode(sha256(convert_to(snap::text, 'UTF8')), 'hex')
   where id = r.id
   returning * into r;
  return r;
end $$;

-- Employee takes the signature back. Allowed only while status = 'signed' (not yet approved).
create or replace function public.unsign_report(p_report uuid)
returns public.reports
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.reports;
begin
  select * into r from public.reports where id = p_report for update;
  if not found or r.user_id is distinct from auth.uid() then
    raise exception 'Report not found';
  end if;
  if r.status <> 'signed' then
    raise exception 'Only a signed, not-yet-approved report can be unsigned (status: %)', r.status;
  end if;
  update public.reports
     set status = 'draft', signed_name = null, signed_at = null,
         snapshot = null, snapshot_hash = null
   where id = r.id
   returning * into r;
  return r;
end $$;

-- Manager/owner approves. Managers and owners' own reports need an owner.
create or replace function public.approve_report(p_report uuid)
returns public.reports
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.reports;
  v_target_role text;
begin
  select * into r from public.reports where id = p_report for update;
  if not found or r.org_id is distinct from public.app_org() then
    raise exception 'Report not found';
  end if;
  if not public.is_manager() then raise exception 'Only a manager or owner can approve'; end if;
  if r.status <> 'signed' then raise exception 'Only a signed report can be approved (status: %)', r.status; end if;
  select role into v_target_role from public.profiles where user_id = r.user_id;
  if v_target_role in ('manager', 'owner') and public.app_role() <> 'owner' then
    raise exception 'Only an owner can approve a manager or owner report';
  end if;
  update public.reports
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = r.id
   returning * into r;
  return r;
end $$;

-- Manager/owner records payment.
create or replace function public.mark_paid(p_report uuid, p_paid_date date, p_method text)
returns public.reports
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.reports;
begin
  select * into r from public.reports where id = p_report for update;
  if not found or r.org_id is distinct from public.app_org() then
    raise exception 'Report not found';
  end if;
  if not public.is_manager() then raise exception 'Only a manager or owner can record payment'; end if;
  if r.status <> 'approved' then raise exception 'Only an approved report can be marked paid (status: %)', r.status; end if;
  if p_paid_date is null then raise exception 'Date paid is required'; end if;
  if p_method not in ('check', 'direct_deposit', 'cash', 'other') then
    raise exception 'Invalid payment method';
  end if;
  update public.reports
     set status = 'paid', paid_date = p_paid_date, payment_method = p_method
   where id = r.id
   returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Function privileges: logged-in users only, and only the ones the app calls.
-- ---------------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' loop
    execute format('revoke all on function %s from public, anon', f.sig);
  end loop;
end $$;

grant execute on function
  public.app_org(), public.app_role(), public.is_manager(),
  public.create_org(text, text), public.claim_invite(text),
  public.sign_report(uuid, text), public.unsign_report(uuid),
  public.approve_report(uuid), public.mark_paid(uuid, date, text)
to authenticated;
