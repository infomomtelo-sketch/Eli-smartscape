// Builds the display/export model for one report. Signed reports use their frozen
// snapshot; drafts use the live trips. Used by the screen, the PDF and the CSV.
import { summarize, monthLabel, toCsv, round2 } from './util.js';

export function buildModel({ report, trips = [], people = [], orgName = '' }) {
  const snap = report.snapshot;
  const nameOf = (id) => (people.find((p) => p.user_id === id) || {}).full_name || '';
  const rows = snap
    ? snap.trips.map((t) => ({
        date: t.date, from: t.from, to: t.to, purpose: t.purpose,
        miles: Number(t.miles), rate: Number(t.rate), amount: Number(t.amount),
      }))
    : [...trips]
        .sort((a, b) => a.trip_date.localeCompare(b.trip_date) || a.created_at.localeCompare(b.created_at))
        .map((t) => ({
          date: t.trip_date, from: t.from_label, to: t.to_label, purpose: t.purpose,
          miles: Number(t.miles), rate: Number(t.rate_applied), amount: Number(t.amount),
        }));
  const s = summarize(rows);
  return {
    orgName,
    employee: snap ? snap.employee_name : nameOf(report.user_id),
    month: report.month,
    monthLabel: monthLabel(report.month),
    status: report.status,
    rows,
    ...s,
    signedName: report.signed_name,
    signedAt: report.signed_at,
    approvedBy: report.approved_by ? nameOf(report.approved_by) : '',
    approvedAt: report.approved_at,
    paidDate: report.paid_date,
    paymentMethod: report.payment_method,
    hash: report.snapshot_hash,
  };
}

export function tripsCsv(m) {
  const head = ['Employee', 'Month', 'Date', 'From', 'To', 'Business purpose', 'Miles', 'Rate per mile', 'Amount'];
  const body = m.rows.map((r) => [
    m.employee, m.month.slice(0, 7), r.date, r.from, r.to, r.purpose,
    r.miles.toFixed(2), String(r.rate), r.amount.toFixed(2),
  ]);
  const foot = [['', '', '', '', '', 'TOTAL', m.totalMiles.toFixed(2), '', m.total.toFixed(2)]];
  return toCsv([head, ...body, ...foot]);
}

// One line per report, for payroll.
export function payrollCsv(models) {
  const head = ['Employee', 'Month', 'Status', 'Total miles', 'Total expense', 'Approved by', 'Date approved', 'Date paid', 'Payment method'];
  const body = models.map((m) => [
    m.employee, m.month.slice(0, 7), m.status, m.totalMiles.toFixed(2), m.total.toFixed(2),
    m.approvedBy, m.approvedAt ? m.approvedAt.slice(0, 10) : '', m.paidDate || '', m.paymentMethod || '',
  ]);
  const sum = round2(models.reduce((a, m) => a + m.total, 0));
  return toCsv([head, ...body, ['TOTAL', '', '', '', sum.toFixed(2), '', '', '', '']]);
}
