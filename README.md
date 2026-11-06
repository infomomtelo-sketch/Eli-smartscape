# Mileage Reimbursement

Mileage-reimbursement tracker for multi-home care operators (California, Labor Code 2802).
Mobile-first web app: Cloudflare Pages (static) + Supabase (auth + Postgres with RLS).
No PHI and no resident data. **This is a record-keeping tool, not legal advice.**

## What it does

- **Log trip** (mobile form): date, From/To (pick a home or type), purpose (default "Between care homes"), miles. The first time a pair of places gets miles it is saved as a route; next time it auto-fills. Warns if a place is marked personal/home.
- **Report**: monthly trips, total miles, mixed-rate breakdown, total expense. Type your name to sign (timestamped); signing locks the month. Unsign until approved.
- **Approvals** (manager/owner): approve, then record date paid + method. History of every status change.
- **Setup** (manager/owner): homes, saved routes, org rate table with effective dates (owner), people and invites (owner).
- **Export**: PDF matching the paper form (plus a purpose column) and CSV; payroll CSV across reports.
- Status flow: `draft -> signed -> approved -> paid`.

## Deploy

### 1. Database (once)
In Supabase (project `dmemzljerldzeiwqfxzp`) open **SQL Editor** and run, in order, the full contents of:

1. `supabase/migrations/001_schema.sql`
2. `supabase/migrations/002_rls.sql`
3. `supabase/migrations/003_triggers.sql`

Then **Authentication > Providers**: keep Email (magic link) on. Under **Authentication > URL Configuration** set *Site URL* to your Pages URL and add it to *Redirect URLs* (magic links won't work otherwise).

### 2. Config
Put the project's **anon public** key in `config.js` (Project Settings > API). It is designed to be public; RLS protects the data. **Never put the service-role key anywhere in this repo.**

### 3. Cloudflare Pages
Create a Pages project from this repo: framework preset *None*, build command empty, output directory `/`. `_headers` adds basic security headers. For local preview: `npm run dev`.

### First use
Sign in with your email. First person chooses **Create organization** and becomes owner (the org's rate table is seeded with 2026-01-01 = $0.725 and 2026-07-01 = $0.76). The owner adds homes, then invites people from **Setup > People**; invitees sign in with the invited email and choose **Join my organization**.

## Rules enforced in the database (not just the UI)

- **Org scoping:** every table has `org_id`; RLS compares it with the caller's profile. `org_id` is set by trigger, never trusted from the client.
- **Rates:** per org with effective dates; a trip's rate is the latest `effective_date <= trip_date`, set by trigger. Amount per trip = `round(miles x rate, 2)`; a report's total is the sum of those.
- **Locking:** trips can only change while the report is `draft`. Signing re-prices trips and stores a frozen JSON snapshot plus its SHA-256; PDFs/CSVs of signed reports are built from that snapshot.
- **Status changes** only through `sign_report`, `unsign_report` (until approved), `approve_report`, `mark_paid`. Clients cannot update `reports` directly.
- **Retention:** signed reports, trips, audit rows, users and orgs cannot be deleted (FKs are `restrict`, delete triggers/permissions block it). People and homes are deactivated, not removed.
- **Audit:** every status change writes `audit_log` (who, what, when); the table is append-only.
- **Approval rule:** a manager/owner approves employee reports; only an owner can approve a manager's or owner's report.

## Tests

```
npm test          # pure logic (rates, routes, totals, CSV)
npm run test:db   # all migrations + 57 RLS/trigger/flow checks on a throwaway Postgres 16
npm run test:ui   # headless-Chromium run of the real UI against an in-memory Supabase stand-in
                  # (needs `playwright`; set JSPDF_FILE=<jspdf.umd.min.js> to also test PDF output offline)
```

## Assumptions to confirm with your employer / counsel

- Policy on home-to-first-site commute is the owner's call; the app only warns.
- The PDF follows the paper form's fields and order as described (employee, month, trip rows with purpose, total miles, rate, total expense, employee signature, approved by, date paid, method). Compare it with the actual form.
- Records are never deleted by the app; the 3-year minimum retention is satisfied by keeping everything.

## Out of scope

GPS tracking, Maps API, payments, payroll integration, AI features, native app.
