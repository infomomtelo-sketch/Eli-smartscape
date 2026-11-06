import { db, must } from '../supabase.js';
import { state } from '../store.js';
import { html, show, toast, run } from '../ui.js';
import {
  todayStr, fmtDate, fmtDateTime, money, miles as fmtMiles, rateStr, monthLabel,
  download, safeFile, PAYMENT_METHODS,
} from '../util.js';
import { buildModel, tripsCsv, payrollCsv } from '../report-model.js';

export async function view(root) {
  let filter = 'signed';     // signed | approved | paid | all
  let monthFilter = '';      // '' or YYYY-MM
  let reports = [];
  let selected = null;       // report id
  let audit = [];

  const modelOf = (r) => buildModel({ report: r, people: state.people, orgName: state.org.name });
  const label = (v) => (PAYMENT_METHODS.find((m) => m[0] === v) || [, v])[1];

  async function load() {
    let q = db.from('reports').select('*').neq('status', 'draft')
      .order('month', { ascending: false }).order('signed_at', { ascending: false });
    if (filter !== 'all') q = q.eq('status', filter);
    if (monthFilter) q = q.eq('month', monthFilter + '-01');
    reports = await must(q);
    if (selected && !reports.some((r) => r.id === selected)) selected = null;
    audit = selected
      ? await must(db.from('audit_log').select('*').eq('report_id', selected).order('id'))
      : [];
  }

  const whoName = (id) => (state.people.find((p) => p.user_id === id) || {}).full_name || 'Unknown';

  function detail() {
    const r = reports.find((x) => x.id === selected);
    if (!r) return '';
    const m = modelOf(r);
    return html`
      <div class="card">
        <div class="row tight" style="justify-content:space-between;align-items:center">
          <div><b>${m.employee}</b><div class="muted">${m.monthLabel}</div></div>
          <span class="badge ${r.status}">${r.status}</span>
        </div>
        <div class="scroll"><table>
          <thead><tr><th>Date</th><th>Trip</th><th class="num">Miles</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
          <tbody>${m.rows.map((t) => html`<tr><td>${fmtDate(t.date)}</td>
            <td>${t.from} → ${t.to}<div class="muted">${t.purpose}</div></td>
            <td class="num">${fmtMiles(t.miles)}</td><td class="num">${rateStr(t.rate)}</td>
            <td class="num">${money(t.amount)}</td></tr>`)}</tbody>
          <tfoot><tr><td colspan="2">Total</td><td class="num">${fmtMiles(m.totalMiles)}</td><td></td>
            <td class="num">${money(m.total)}</td></tr></tfoot>
        </table></div>
        <p>Signed by <b>${r.signed_name}</b> on ${fmtDateTime(r.signed_at)}.</p>
        ${r.approved_by ? html`<p>Approved by <b>${whoName(r.approved_by)}</b> on ${fmtDateTime(r.approved_at)}.</p>` : ''}
        ${r.paid_date ? html`<p>Paid ${fmtDate(r.paid_date)} by ${label(r.payment_method)}.</p>` : ''}

        ${r.status === 'signed' ? html`<div class="actions"><button id="approve">Approve</button></div>` : ''}
        ${r.status === 'approved' ? html`
          <h3>Record payment</h3>
          <div class="row">
            <div><label for="pd">Date paid</label><input id="pd" type="date" value="${todayStr()}"></div>
            <div><label for="pm">Method</label><select id="pm">
              ${PAYMENT_METHODS.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</select></div>
          </div>
          <div class="actions"><button id="paid">Mark paid</button></div>` : ''}
        <div class="actions">
          <button id="pdf" class="secondary">PDF</button>
          <button id="csv" class="secondary">CSV</button>
        </div>
        <h3>History</h3>
        <table><tbody>${audit.map((a) => html`<tr><td>${fmtDateTime(a.at)}</td>
          <td>${a.action}${a.from_status ? html` <span class="muted">(${a.from_status} → ${a.to_status})</span>` : ''}</td>
          <td>${whoName(a.actor_id)}</td></tr>`)}</tbody></table>
      </div>`;
  }

  function draw() {
    show(root, html`
      <div class="card">
        <div class="row">
          <div><label for="st" style="margin-top:0">Status</label><select id="st">
            ${[['signed', 'Waiting for approval'], ['approved', 'Approved, unpaid'], ['paid', 'Paid'], ['all', 'All']]
              .map(([v, l]) => html`<option value="${v}" ${v === filter ? 'selected' : ''}>${l}</option>`)}</select></div>
          <div><label for="mo" style="margin-top:0">Month</label>
            <input id="mo" type="month" value="${monthFilter}"></div>
        </div>
      </div>
      <div class="card">
        ${reports.length === 0 ? html`<p class="muted">No reports match.</p>` : html`
        <div class="scroll"><table>
          <thead><tr><th>Employee</th><th>Month</th><th>Status</th><th class="num">Total</th></tr></thead>
          <tbody>${reports.map((r) => { const m = modelOf(r); return html`
            <tr data-id="${r.id}" style="cursor:pointer;${r.id === selected ? 'background:#eef5f0' : ''}">
              <td><button class="link">${m.employee}</button></td><td>${monthLabel(r.month)}</td>
              <td><span class="badge ${r.status}">${r.status}</span></td><td class="num">${money(m.total)}</td></tr>`; })}</tbody>
        </table></div>
        <div class="actions"><button id="payroll" class="secondary">Download payroll CSV (${reports.length})</button></div>`}
      </div>
      ${detail()}`);

    root.querySelector('#st').addEventListener('change', async (e) => { filter = e.target.value; selected = null; await run(load); draw(); });
    root.querySelector('#mo').addEventListener('change', async (e) => { monthFilter = e.target.value; selected = null; await run(load); draw(); });
    root.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', async () => {
      selected = tr.dataset.id; await run(load); draw();
      root.querySelector('#pdf')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
    const payroll = root.querySelector('#payroll');
    if (payroll) payroll.addEventListener('click', () =>
      download(`payroll-${monthFilter || 'all'}-${filter}.csv`, payrollCsv(reports.map(modelOf))));

    const r = reports.find((x) => x.id === selected);
    if (!r) return;
    const act = (sel, fn, msg) => {
      const b = root.querySelector(sel);
      if (b) b.addEventListener('click', () => run(async () => { await fn(); await load(); draw(); toast(msg); }, b));
    };
    act('#approve', async () => {
      const { error } = await db.rpc('approve_report', { p_report: r.id });
      if (error) throw new Error(error.message);
    }, 'Approved');
    act('#paid', async () => {
      const { error } = await db.rpc('mark_paid', {
        p_report: r.id, p_paid_date: root.querySelector('#pd').value, p_method: root.querySelector('#pm').value,
      });
      if (error) throw new Error(error.message);
    }, 'Marked paid');
    const m = modelOf(r);
    const file = `${safeFile(m.employee)}-${r.month.slice(0, 7)}`;
    root.querySelector('#csv').addEventListener('click', () => download(`mileage-${file}.csv`, tripsCsv(m)));
    root.querySelector('#pdf').addEventListener('click', (e) => run(async () => {
      const { reportPdf } = await import('../pdf.js');
      await reportPdf(m, false);
    }, e.target));
  }

  await load();
  draw();
}
