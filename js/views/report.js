import { db, must } from '../supabase.js';
import { state } from '../store.js';
import { html, raw, show, toast, run } from '../ui.js';
import {
  todayStr, monthStart, fmtDate, fmtDateTime, money, miles as fmtMiles, rateStr,
  download, safeFile, PAYMENT_METHODS,
} from '../util.js';
import { buildModel, tripsCsv } from '../report-model.js';

export async function view(root) {
  let month = monthStart(todayStr());
  let report = null;
  let trips = [];

  async function load() {
    report = await must(db.from('reports').select('*')
      .eq('user_id', state.profile.user_id).eq('month', month).maybeSingle());
    trips = report
      ? await must(db.from('trips').select('*').eq('report_id', report.id).order('trip_date'))
      : [];
  }

  function draw() {
    const model = report
      ? buildModel({ report, trips, people: state.people, orgName: state.org.name })
      : null;
    const status = report ? report.status : 'draft';
    const personal = trips.filter((t) => [t.from_key, t.to_key].some((k) => {
      const h = state.homes.find((x) => 'home:' + x.id === k);
      return h && h.is_personal;
    }));
    const methodLabel = (v) => (PAYMENT_METHODS.find((m) => m[0] === v) || [, v])[1];

    show(root, html`
      <div class="card">
        <label for="month" style="margin-top:0">Month</label>
        <input id="month" type="month" value="${month.slice(0, 7)}">
      </div>

      ${!model || model.rows.length === 0 ? html`<div class="card"><p class="muted">No trips logged for this month.</p></div>` : html`
      <div class="card">
        <div class="row tight" style="justify-content:space-between;align-items:center">
          <div><b>${model.employee}</b><div class="muted">${model.monthLabel}</div></div>
          <span class="badge ${status}">${status}</span>
        </div>
        ${personal.length ? html`<div class="warn">⚠ ${personal.length} trip(s) start or end at a place marked personal/home.
          Home-to-first-site commuting is normally not reimbursable. Review with your employer.</div>` : ''}
        <div class="scroll"><table>
          <thead><tr><th>Date</th><th>Trip</th><th class="num">Miles</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
          <tbody>${model.rows.map((r) => html`<tr><td>${fmtDate(r.date)}</td>
            <td>${r.from} → ${r.to}<div class="muted">${r.purpose}</div></td>
            <td class="num">${fmtMiles(r.miles)}</td><td class="num">${rateStr(r.rate)}</td>
            <td class="num">${money(r.amount)}</td></tr>`)}</tbody>
          <tfoot><tr><td colspan="2">Total</td><td class="num">${fmtMiles(model.totalMiles)}</td><td></td>
            <td class="num">${money(model.total)}</td></tr></tfoot>
        </table></div>
        ${model.breakdown.length > 1 ? html`<h3>Rate breakdown</h3><table><tbody>
          ${model.breakdown.map((b) => html`<tr><td>${fmtMiles(b.miles)} mi at ${rateStr(b.rate)}</td>
            <td class="num">${money(b.amount)}</td></tr>`)}</tbody></table>` : ''}
        <h3>Total expense: ${money(model.total)}</h3>
      </div>

      <div class="card">
        ${status === 'draft' ? html`
          <h3 style="margin-top:0">Sign this month</h3>
          <p class="muted">Signing locks the trips. By typing your full name you certify these miles were driven for
            business purposes. You can unsign until it is approved.</p>
          <label for="sig">Type your full name</label>
          <input id="sig" autocomplete="name" placeholder="${state.profile.full_name}">
          <div class="actions"><button id="sign">Sign and lock ${model.monthLabel}</button></div>` : ''}
        ${status !== 'draft' ? html`
          <p>Signed by <b>${report.signed_name}</b> on ${fmtDateTime(report.signed_at)}.</p>
          ${report.approved_by ? html`<p>Approved by <b>${model.approvedBy}</b> on ${fmtDateTime(report.approved_at)}.</p>` : ''}
          ${report.paid_date ? html`<p>Paid ${fmtDate(report.paid_date)} by ${methodLabel(report.payment_method)}.</p>` : ''}
          ${status === 'signed' ? html`<p class="muted">Waiting for manager approval.</p>
            <div class="actions"><button id="unsign" class="secondary">Unsign to make changes</button></div>` : ''}` : ''}
        <div class="actions">
          <button id="pdf" class="secondary">Download PDF</button>
          <button id="csv" class="secondary">Download CSV</button>
        </div>
      </div>`}`);

    root.querySelector('#month').addEventListener('change', async (e) => {
      if (!e.target.value) return;
      month = e.target.value + '-01';
      await run(load); draw();
    });
    if (!model || model.rows.length === 0) return;

    const sign = root.querySelector('#sign');
    if (sign) sign.addEventListener('click', () => run(async () => {
      const name = root.querySelector('#sig').value.trim();
      if (name.length < 2) throw new Error('Type your full name to sign');
      if (name.toLowerCase() !== state.profile.full_name.toLowerCase() &&
          !confirm(`You typed "${name}" but your profile name is "${state.profile.full_name}". Sign as "${name}"?`)) return;
      const { error } = await db.rpc('sign_report', { p_report: report.id, p_name: name });
      if (error) throw new Error(error.message);
      await load(); draw(); toast('Signed. The month is locked.');
    }, sign));

    const unsign = root.querySelector('#unsign');
    if (unsign) unsign.addEventListener('click', () => run(async () => {
      if (!confirm('Unsign this month? Your signature will be removed and trips become editable.')) return;
      const { error } = await db.rpc('unsign_report', { p_report: report.id });
      if (error) throw new Error(error.message);
      await load(); draw(); toast('Unsigned');
    }, unsign));

    const file = `${safeFile(model.employee)}-${month.slice(0, 7)}`;
    root.querySelector('#csv').addEventListener('click', () =>
      download(`mileage-${file}.csv`, tripsCsv(model)));
    root.querySelector('#pdf').addEventListener('click', (e) => run(async () => {
      const { reportPdf } = await import('../pdf.js');
      await reportPdf(model, status === 'draft');
    }, e.target));
  }

  await load();
  draw();
}
