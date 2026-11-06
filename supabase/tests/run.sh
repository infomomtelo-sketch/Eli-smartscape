#!/usr/bin/env bash
# Runs the migrations + behavioural tests against a throwaway local Postgres (16+).
# Usage: supabase/tests/run.sh   (needs initdb/pg_ctl on PATH or PGBIN set; run as a non-root user)
set -euo pipefail
cd "$(dirname "$0")/../.."
BIN="${PGBIN:-$(dirname "$(command -v initdb || echo /usr/lib/postgresql/16/bin/initdb)")}"
D="$(mktemp -d)"; PORT=5546
"$BIN/initdb" -D "$D/data" -A trust >/dev/null
"$BIN/pg_ctl" -D "$D/data" -o "-p $PORT -k $D" -l "$D/log" -w start >/dev/null
trap '"$BIN/pg_ctl" -D "$D/data" -m fast stop >/dev/null; rm -rf "$D"' EXIT
P=(psql -h "$D" -p $PORT -U "$(whoami)" -v ON_ERROR_STOP=1 -q)
"${P[@]}" -d postgres -c 'create database t'
"${P[@]}" -d t -f supabase/tests/00_stub_auth.sql
for f in supabase/migrations/*.sql; do "${P[@]}" -d t -f "$f"; done
# the test file intentionally issues a few statements that must be rejected
out=$(psql -h "$D" -p $PORT -U "$(whoami)" -d t -q -f supabase/tests/10_rls_and_rules.sql 2>&1)
echo "$out" | grep -E "FAIL|failures|^ +[0-9]+ +\| +[0-9]+" || true
echo "$out" | grep -q "^ *0 *| *[0-9]" && echo "DB TESTS OK" || { echo "DB TESTS FAILED"; exit 1; }
