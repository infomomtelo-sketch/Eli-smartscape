import { db, must } from '../supabase.js';
import { state, loadRoutes } from '../store.js';
import { html, raw, show, toast, run } from '../ui.js';
import {
  todayStr, monthStart, monthLabel, fmtDate, money, miles as fmtMiles, rateStr,
  resolveLocation, findRoute, DEFAULT_PURPOSE,
} from '../util.js';

export async function view(root) {
  let month = monthStart(todayStr());
  let report = null;
  let trips = [];
  let editing = null;       // trip being edited, or null
  let autofilled = false;   // miles currently came from a saved route

  async function loadMonth(m) {
    month = m;
    report = await must(db.from('reports').select('*')
      .eq('user_id', state.profile.user_id).eq('month', m).maybeSingle());
    trips = report
      ? await must(db.from('trips').select('*').eq('report_id', report.id)
          .order('trip_date').order('created_at'))
      : [];
  }

  const locked = () => !!report && report.status !== 'draft';

  function draw() {
    const homeOpts = state.homes.filter((h) => h.active).map((h) => html`<option value="${h.name}"></option>`);
    const total = trips.reduce((a, t) => a + Number(t.amount), 0);
    const totalMiles = trips.reduce((a, t) => a + Number(t.miles), 0);
    const e = editing;
    show(root, html`
      <div class="card">
        <h2 style="margin-top:0">${e ? 'Edit trip' : 'Log a trip'}</h2>
        ${locked() ? html`<div class="warn">${monthLabel(month)} is <b>${report.status}</b>, so trips are locked.
          ${report.status === 'signed' ? 'Unsign it on the Report tab to make changes.' : ''}</div>` : ''}
        <form id="f" autocomplete="off">
          <label for="date">Date</label>
          <input id="date" type="date" required value="${e ? e.trip_date : todayStr()}">
          <div class="row">
            <div><label for="from">From</label>
              <input id="from" list="homes" placeholder="Pick a home or type" required value="${e ? e.from_label : ''}"></div>
            <div><label for="to">To</label>
              <input id="to" list="homes" placeholder="Pick a home or type" required value="${e ? e.to_label : ''}"></div>
          </div>
          <datalist id="homes">${homeOpts}</datalist>
          <div id="warn"></div>
          <label for="purpose">Business purpose</label>
          <input id="purpose" required value="${e ? e.purpose : DEFAULT_PURPOSE}">
          <label for="miles">Miles</label>
          <input id="miles" type="number" inputmode="decimal" min="0.01" step="0.01" required value="${e ? e.miles : ''}">
          <div class="hint" id="hint"></div>
          <div class="actions">
            <button type="submit" ${locked() ? 'disabled' : ''}>${e ? 'Save changes' : 'Add trip'}</button>
            ${e ? raw('<button type="button" class="secondary" id="cancel">Cancel</button>') : ''}
          </div>
        </form>
      </div>

      <h2>${monthLabel(month)}</h2>
      <div class="card">
        ${trips.length === 0 ? html`<p class="muted">No trips yet this month.</p>` : html`
        <div class="scroll"><table>
          <thead><tr><th>Date</th><th>Trip</th><th class="num">Miles</th><th class="num">Amount</th><th></th></tr></thead>
          <tbody>${trips.map((t) => html`<tr>
            <td>${fmtDate(t.trip_date)}</td>
            <td>${t.from_label} → ${t.to_label}<div class="muted">${t.purpose} · ${rateStr(t.rate_applied)}/mi</div></td>
            <td class="num">${fmtMiles(t.miles)}</td>
            <td class="num">${money(t.amount)}</td>
            <td>${locked() ? '' : html`<button class="link" data-edit="${t.id}">Edit</button>
                <button class="link" data-del="${t.id}">Delete</button>`}</td></tr>`)}</tbody>
          <tfoot><tr><td colspan="2">Total</td><td class="num">${fmtMiles(totalMiles)}</td>
            <td class="num">${money(total)}</td><td></td></tr></tfoot>
        </table></div>`}
      </div>`);
    wire();
    hints();
  }

  // Resolve From/To, show personal-home warning, auto-fill miles from a saved route.
  function hints() {
    const from = resolveLocation(root.querySelector('#from').value, state.homes);
    const to = resolveLocation(root.querySelector('#to').value, state.homes);
    const warn = root.querySelector('#warn');
    const hint = root.querySelector('#hint');
    const milesEl = root.querySelector('#miles');

    const personal = [from, to].filter((l) => l && l.home && l.home.is_personal);
    warn.innerHTML = personal.length
      ? html`<div class="warn">⚠ <b>${personal.map((l) => l.label).join(' and ')}</b> is marked personal/home.
          Home-to-first-site commuting is normally not reimbursable. Your employer decides final policy.</div>`.s
      : '';

    hint.textContent = '';
    if (!from || !to) return;
    if (from.key === to.key) { hint.textContent = 'From and To are the same place.'; return; }
    const route = findRoute(state.routes, from.key, to.key);
    if (route) {
      if (!milesEl.value || autofilled) { milesEl.value = route.miles; autofilled = true; }
      hint.textContent = `Saved route: ${fmtMiles(route.miles)} mi` +
        (Number(milesEl.value) !== Number(route.miles) ? ' (you entered a different number; managers can edit saved routes)' : '');
    } else {
      hint.textContent = 'New route: these miles will be saved for next time.';
    }
  }

  function wire() {
    const q = (s) => root.querySelector(s);
    ['#from', '#to'].forEach((s) => q(s).addEventListener('input', () => { hints(); }));
    q('#miles').addEventListener('input', () => { autofilled = false; hints(); });
    q('#date').addEventListener('change', async (ev) => {
      const m = monthStart(ev.target.value || todayStr());
      if (m !== month) {
        const keep = { from: q('#from').value, to: q('#to').value, purpose: q('#purpose').value, miles: q('#miles').value, date: ev.target.value };
        await run(() => loadMonth(m));
        draw();
        q('#date').value = keep.date; q('#from').value = keep.from; q('#to').value = keep.to;
        q('#purpose').value = keep.purpose; q('#miles').value = keep.miles;
        hints();
      }
    });
    q('#f').addEventListener('submit', (ev) => { ev.preventDefault(); save(ev.submitter); });
    const cancel = q('#cancel');
    if (cancel) cancel.addEventListener('click', () => { editing = null; autofilled = false; draw(); });
    root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      editing = trips.find((t) => t.id === b.dataset.edit); autofilled = false; draw(); scrollTo(0, 0);
    }));
    root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      if (!confirm('Delete this trip?')) return;
      run(async () => {
        await must(db.from('trips').delete().eq('id', b.dataset.del));
        await loadMonth(month); draw(); toast('Trip deleted');
      }, b);
    }));
  }

  async function save(btn) {
    await run(async () => {
      const q = (s) => root.querySelector(s).value;
      const date = q('#date');
      const from = resolveLocation(q('#from'), state.homes);
      const to = resolveLocation(q('#to'), state.homes);
      const purpose = q('#purpose').trim();
      const mi = Number(q('#miles'));
      if (!date || !from || !to || !purpose) throw new Error('Fill in date, From, To and purpose');
      if (from.key === to.key) throw new Error('From and To are the same place');
      if (!(mi > 0)) throw new Error('Enter the miles driven');

      const m = monthStart(date);
      if (m !== month) await loadMonth(m);
      if (!report) {
        report = await must(db.from('reports').insert({ month: m }).select().single());
      }
      if (report.status !== 'draft') throw new Error(`${monthLabel(m)} is ${report.status}; trips are locked`);

      const row = {
        trip_date: date, from_key: from.key, from_label: from.label,
        to_key: to.key, to_label: to.label, purpose, miles: mi,
      };
      if (editing) {
        await must(db.from('trips').update(row).eq('id', editing.id));
      } else {
        await must(db.from('trips').insert({ ...row, report_id: report.id }));
      }

      // First time this pair is entered: save the miles for next time.
      if (!findRoute(state.routes, from.key, to.key)) {
        const { error } = await db.from('routes').insert({
          a_key: from.key, a_label: from.label, b_key: to.key, b_label: to.label, miles: mi,
        });
        if (error && error.code !== '23505') toast('Trip saved, but the route could not be saved: ' + error.message, 'err');
        await loadRoutes();
      }

      const wasEdit = !!editing;
      editing = null; autofilled = false;
      await loadMonth(m);
      draw();
      root.querySelector('#date').value = date;
      toast(wasEdit ? 'Trip updated' : 'Trip added');
    }, btn);
  }

  await loadMonth(month);
  draw();
}
