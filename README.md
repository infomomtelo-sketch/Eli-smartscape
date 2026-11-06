# Mileage Reimbursement

Mileage-reimbursement tracker for multi-home care operators (California, Labor Code 2802).
Cloudflare Pages + Functions, Supabase (auth + Postgres with RLS). No PHI, no resident data.

This is a record-keeping tool, not legal advice.

## Status

Stage 1 of 7: database schema, RLS, triggers (`supabase/migrations/`).

## Run the migrations (Supabase project `dmemzljerldzeiwqfxzp`)

In the Supabase dashboard open **SQL Editor** and run, in order, each file's full contents:

1. `supabase/migrations/001_schema.sql`
2. `supabase/migrations/002_rls.sql`
3. `supabase/migrations/003_triggers.sql`

Then, under **Authentication**, keep email (magic link) enabled.

## How the database enforces the rules

- **Org scoping:** every table has `org_id`; RLS compares it with the caller's profile. `org_id` is overwritten by trigger on insert, never taken from the client.
- **Rates:** `mileage_rates` per org with effective dates. A trip's rate is the latest `effective_date <= trip_date`, set by trigger. New orgs are seeded by `create_org()` with 2026-01-01 = 0.725 and 2026-07-01 = 0.76.
- **Amounts:** per trip `round(miles * rate, 2)`, report total is the sum of those.
- **Status flow:** `draft -> signed -> approved -> paid`, only through `sign_report`, `unsign_report` (until approved), `approve_report`, `mark_paid`. Clients cannot update `reports` directly.
- **Locking:** trips can only be inserted, edited or deleted while the report is `draft`. Signing re-prices the trips and stores a frozen JSON snapshot plus its SHA-256 hash.
- **Retention:** signed reports, trips, audit rows, users and orgs cannot be deleted (FKs are `restrict`, delete triggers/permissions block it). People are deactivated, not removed.
- **Audit:** every status change writes `audit_log` (who, what, when). The table is append-only.
- **Approval rule:** a manager or owner approves employee reports; only an owner can approve a manager's or owner's report.
- **Onboarding:** first login calls `create_org(org_name, full_name)` (becomes owner) or `claim_invite(full_name)` (owner invited their email).
