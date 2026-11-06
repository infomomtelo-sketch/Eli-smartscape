-- 001_schema.sql
-- Mileage reimbursement SaaS: tables and constraints only.
-- Every table is scoped by org_id. No PHI and no resident data is stored.
-- Nothing here is ever hard-deleted once signed (see 003_triggers.sql).

create table public.orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  created_at  timestamptz not null default now()
);

-- One row per signed-in person. Users are deactivated (active = false), never deleted,
-- so their signed reports stay attributable for the 3-year retention period.
create table public.profiles (
  user_id     uuid primary key references auth.users (id) on delete restrict,
  org_id      uuid not null references public.orgs (id) on delete restrict,
  full_name   text not null check (length(trim(full_name)) > 0),
  role        text not null check (role in ('employee', 'manager', 'owner')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index profiles_org_idx on public.profiles (org_id);

-- Owner invites a person by email; the person claims it after their first magic-link login.
create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete restrict,
  email       text not null,
  full_name   text,
  role        text not null check (role in ('employee', 'manager', 'owner')),
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  unique (org_id, email)
);

create table public.homes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete restrict,
  name        text not null check (length(trim(name)) > 0),
  address     text,
  -- Marks an employee's personal home / non-reimbursable start point (commute warning).
  is_personal boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index homes_org_idx on public.homes (org_id);

-- Saved routes: one row per unordered pair of locations.
-- A location key is 'home:<uuid>' or 'text:<lowercased, trimmed, single-spaced text>'.
-- A trigger orders each pair (a_key <= b_key) so A->B and B->A are the same route.
create table public.routes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete restrict,
  a_key       text not null check (a_key ~ '^(home:[0-9a-f-]{36}|text:.+)$'),
  a_label     text not null,
  b_key       text not null check (b_key ~ '^(home:[0-9a-f-]{36}|text:.+)$'),
  b_label     text not null,
  miles       numeric(7,2) not null check (miles > 0),
  created_by  uuid references public.profiles (user_id) on delete restrict,
  created_at  timestamptz not null default now(),
  check (a_key <> b_key),
  unique (org_id, a_key, b_key)
);

-- Org-level rate table. The rate for a trip is the row with the latest
-- effective_date on or before the trip date.
create table public.mileage_rates (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs (id) on delete restrict,
  effective_date date not null,
  rate_per_mile  numeric(6,4) not null check (rate_per_mile > 0),
  created_at     timestamptz not null default now(),
  unique (org_id, effective_date)
);

-- One report per employee per month. status: draft -> signed -> approved -> paid.
create table public.reports (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete restrict,
  user_id         uuid not null default auth.uid() references public.profiles (user_id) on delete restrict,
  month           date not null check (month = date_trunc('month', month)::date),
  status          text not null default 'draft' check (status in ('draft', 'signed', 'approved', 'paid')),
  signed_name     text,
  signed_at       timestamptz,
  -- Frozen copy of the report at signing (trips, rates used, totals) and its SHA-256.
  snapshot        jsonb,
  snapshot_hash   text,
  approved_by     uuid references public.profiles (user_id) on delete restrict,
  approved_at     timestamptz,
  paid_date       date,
  payment_method  text check (payment_method in ('check', 'direct_deposit', 'cash', 'other')),
  created_at      timestamptz not null default now(),
  unique (user_id, month)
);
create index reports_org_status_idx on public.reports (org_id, status);

create table public.trips (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id) on delete restrict,
  report_id     uuid not null references public.reports (id) on delete restrict,
  user_id       uuid not null references public.profiles (user_id) on delete restrict,
  trip_date     date not null,
  from_key      text not null,
  from_label    text not null check (length(trim(from_label)) > 0),
  to_key        text not null,
  to_label      text not null check (length(trim(to_label)) > 0),
  purpose       text not null default 'Between care homes' check (length(trim(purpose)) > 0),
  miles         numeric(7,2) not null check (miles > 0),
  -- Set by trigger from the rate table; never trusted from the client.
  rate_applied  numeric(6,4) not null,
  amount        numeric(10,2) not null,
  created_at    timestamptz not null default now()
);
create index trips_report_idx on public.trips (report_id);
create index trips_org_date_idx on public.trips (org_id, trip_date);

-- Append-only log of report status changes.
create table public.audit_log (
  id           bigint generated always as identity primary key,
  org_id       uuid not null references public.orgs (id) on delete restrict,
  report_id    uuid not null references public.reports (id) on delete restrict,
  actor_id     uuid references public.profiles (user_id) on delete restrict,
  action       text not null,
  from_status  text,
  to_status    text,
  detail       jsonb,
  at           timestamptz not null default now()
);
create index audit_log_report_idx on public.audit_log (report_id);
