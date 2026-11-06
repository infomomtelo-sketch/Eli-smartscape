import test from 'node:test';
import assert from 'node:assert/strict';
import {
  monthStart, nextMonthStart, monthLabel, fmtDate, round2, money, rateStr,
  resolveLocation, findRoute, findRate, summarize, csvCell, toCsv,
} from '../js/util.js';
import { buildModel, tripsCsv, payrollCsv } from '../js/report-model.js';

const RATES = [
  { effective_date: '2026-01-01', rate_per_mile: 0.725 },
  { effective_date: '2026-07-01', rate_per_mile: 0.76 },
];

test('rate applies by trip date, not by today', () => {
  assert.equal(findRate(RATES, '2026-06-30').rate_per_mile, 0.725);
  assert.equal(findRate(RATES, '2026-07-01').rate_per_mile, 0.76);
  assert.equal(findRate(RATES, '2026-12-31').rate_per_mile, 0.76);
  assert.equal(findRate(RATES, '2025-12-31'), null);
});

test('month helpers', () => {
  assert.equal(monthStart('2026-08-17'), '2026-08-01');
  assert.equal(nextMonthStart('2026-12-01'), '2027-01-01');
  assert.equal(nextMonthStart('2026-01-01'), '2026-02-01');
  assert.equal(monthLabel('2026-07-01'), 'July 2026');
  assert.equal(fmtDate('2026-07-04'), '07/04/2026');
});

test('money and rate formatting', () => {
  assert.equal(money(7.975), '$7.98');
  assert.equal(money(0), '$0.00');
  assert.equal(rateStr(0.725), '$0.725');
  assert.equal(rateStr(0.76), '$0.76');
  assert.equal(round2(1.005), 1.01);
});

test('mixed-rate breakdown and total are sums of per-trip cents', () => {
  const s = summarize([
    { miles: 10.5, rate: 0.76, amount: 7.98 },
    { miles: 12, rate: 0.8, amount: 9.6 },
    { miles: 4.2, rate: 0.76, amount: 3.19 },
  ]);
  assert.equal(s.totalMiles, 26.7);
  assert.equal(s.total, 20.77);
  assert.deepEqual(s.breakdown, [
    { rate: 0.76, miles: 14.7, amount: 11.17 },
    { rate: 0.8, miles: 12, amount: 9.6 },
  ]);
});

test('typed text matching a home name becomes that home', () => {
  const homes = [{ id: 'abc', name: 'Oak House', is_personal: false }];
  assert.equal(resolveLocation('  oak   HOUSE ', homes).key, 'home:abc');
  assert.equal(resolveLocation('Walmart  Pharmacy', homes).key, 'text:walmart pharmacy');
  assert.equal(resolveLocation('Walmart  Pharmacy', homes).label, 'Walmart Pharmacy');
  assert.equal(resolveLocation('   ', homes), null);
});

test('saved route matches in either direction', () => {
  const routes = [{ a_key: 'home:a', b_key: 'home:b', miles: 4.2 }];
  assert.equal(findRoute(routes, 'home:a', 'home:b').miles, 4.2);
  assert.equal(findRoute(routes, 'home:b', 'home:a').miles, 4.2);
  assert.equal(findRoute(routes, 'home:a', 'home:c'), null);
});

test('CSV quoting and formula neutralising', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell('@cmd'), "'@cmd");
  assert.equal(csvCell(null), '');
  assert.ok(toCsv([['a', 'b']]).endsWith('a,b\r\n'));
});

const people = [
  { user_id: 'u1', full_name: 'Eve Employee' },
  { user_id: 'u2', full_name: 'Max Manager' },
];
const draft = { user_id: 'u1', month: '2026-08-01', status: 'draft', snapshot: null };
const trips = [
  { trip_date: '2026-08-20', created_at: '2', from_label: 'B', to_label: 'A', purpose: 'Between care homes', miles: '12.00', rate_applied: '0.8000', amount: '9.60' },
  { trip_date: '2026-08-10', created_at: '1', from_label: 'A', to_label: 'B', purpose: 'Between care homes', miles: '10.50', rate_applied: '0.7600', amount: '7.98' },
];

test('draft model sorts trips by date and totals them', () => {
  const m = buildModel({ report: draft, trips, people, orgName: 'Acme' });
  assert.equal(m.employee, 'Eve Employee');
  assert.deepEqual(m.rows.map((r) => r.date), ['2026-08-10', '2026-08-20']);
  assert.equal(m.total, 17.58);
  assert.equal(m.totalMiles, 22.5);
  assert.equal(m.breakdown.length, 2);
});

test('signed model uses the frozen snapshot, not live trips', () => {
  const report = {
    ...draft, status: 'approved', approved_by: 'u2', approved_at: '2026-09-01T10:00:00Z',
    snapshot: {
      employee_name: 'Eve E. (as signed)',
      trips: [{ date: '2026-08-10', from: 'A', to: 'B', purpose: 'x', miles: 10, rate: 0.76, amount: 7.6 }],
    },
  };
  const m = buildModel({ report, trips, people });
  assert.equal(m.employee, 'Eve E. (as signed)');
  assert.equal(m.total, 7.6);
  assert.equal(m.approvedBy, 'Max Manager');
});

test('csv exports include every trip row and a total', () => {
  const m = buildModel({ report: draft, trips, people });
  const lines = tripsCsv(m).trim().split('\r\n');
  assert.equal(lines.length, 1 + 2 + 1);
  assert.match(lines[0], /Business purpose/);
  assert.match(lines.at(-1), /17\.58$/);
  const pay = payrollCsv([m]).trim().split('\r\n');
  assert.equal(pay.length, 3);
  assert.match(pay[1], /Eve Employee,2026-08,draft,22\.50,17\.58/);
});
