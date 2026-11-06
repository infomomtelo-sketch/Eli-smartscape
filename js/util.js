// Pure helpers: dates, money, locations/routes, rates, CSV. No DOM, no network.

export const DEFAULT_PURPOSE = 'Between care homes';
export const PAYMENT_METHODS = [
  ['check', 'Check'],
  ['direct_deposit', 'Direct deposit'],
  ['cash', 'Cash'],
  ['other', 'Other'],
];
export const NOTICE = 'This is a record-keeping tool, not legal advice.';

const pad = (n) => String(n).padStart(2, '0');

// ---- dates (always plain YYYY-MM-DD strings; never parsed through UTC) ------
export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function monthStart(dateStr) {
  return dateStr.slice(0, 7) + '-01';
}
export function nextMonthStart(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
}
export function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}
export function fmtDate(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-');
  return `${m}/${d}/${y}`;
}
export function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

// ---- money / numbers -------------------------------------------------------
export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
export function money(n) {
  return '$' + round2(n).toFixed(2);
}
export function miles(n) {
  return round2(n).toFixed(2);
}
// 0.725 -> "$0.725", 0.76 -> "$0.76"
export function rateStr(n) {
  let s = Number(n).toFixed(4).replace(/0+$/, '');
  if ((s.split('.')[1] || '').length < 2) s = Number(n).toFixed(2);
  return '$' + s;
}

// ---- locations and saved routes -------------------------------------------
export function normText(t) {
  return String(t).trim().replace(/\s+/g, ' ').toLowerCase();
}
// Typed text that matches a home's name becomes that home; anything else is free text.
export function resolveLocation(text, homes) {
  const clean = String(text).trim().replace(/\s+/g, ' ');
  if (!clean) return null;
  const n = normText(clean);
  const home = homes.find((h) => normText(h.name) === n);
  if (home) return { key: 'home:' + home.id, label: home.name, home };
  return { key: 'text:' + n, label: clean, home: null };
}
// A route is the same in both directions.
export function findRoute(routes, keyA, keyB) {
  return routes.find((r) =>
    (r.a_key === keyA && r.b_key === keyB) || (r.a_key === keyB && r.b_key === keyA)) || null;
}

// ---- rates ----------------------------------------------------------------
// The rate in effect on a date: latest effective_date on or before it.
export function findRate(rates, dateStr) {
  let best = null;
  for (const r of rates) {
    if (r.effective_date <= dateStr && (!best || r.effective_date > best.effective_date)) best = r;
  }
  return best;
}

// ---- report math (rows: {miles, rate, amount}) -----------------------------
export function summarize(rows) {
  const byRate = new Map();
  let totalMiles = 0;
  let total = 0;
  for (const r of rows) {
    totalMiles += Number(r.miles);
    total += Number(r.amount);
    const b = byRate.get(Number(r.rate)) || { rate: Number(r.rate), miles: 0, amount: 0 };
    b.miles += Number(r.miles);
    b.amount += Number(r.amount);
    byRate.set(Number(r.rate), b);
  }
  return {
    totalMiles: round2(totalMiles),
    total: round2(total),
    breakdown: [...byRate.values()]
      .sort((a, b) => a.rate - b.rate)
      .map((b) => ({ rate: b.rate, miles: round2(b.miles), amount: round2(b.amount) })),
  };
}

// ---- CSV -------------------------------------------------------------------
// Quote when needed, and neutralise spreadsheet formulas (=, +, -, @).
export function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
export function toCsv(rows) {
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
export function download(filename, text, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function safeFile(s) {
  return String(s).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
}
