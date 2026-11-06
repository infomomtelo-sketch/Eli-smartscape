import { db, must } from '../supabase.js';
import { state, isOwner, loadHomes, loadRoutes, loadRates, loadPeople } from '../store.js';
import { html, show, toast, run } from '../ui.js';
import { fmtDate, fmtDateTime, miles as fmtMiles, rateStr, todayStr } from '../util.js';

export async function view(root) {
  const owner = isOwner();
  let invites = [];
  let editHome = null; // home id being edited, or 'new'

  async function loadInvites() {
    invites = owner ? await must(db.from('invites').select('*').is('claimed_at', null).order('created_at')) : [];
  }

  function homesCard() {
    const form = (h) => html`
      <form id="homeform" class="card" style="background:#f8faf8">
        <label>Name</label><input id="hn" required value="${h.name || ''}">
        <label>Address</label><input id="ha" value="${h.address || ''}">
        <label><input id="hp" type="checkbox" ${h.is_personal ? 'checked' : ''}> Personal/home (commute warning)</label>
        <div class="actions"><button type="submit">Save</button>
          <button type="button" class="secondary" id="homecancel">Cancel</button></div>
      </form>`;
    return html`
      <h2>Homes</h2>
      <div class="card">
        ${state.homes.length === 0 ? html`<p class="muted">No homes yet.</p>` : html`<table><tbody>
          ${state.homes.map((h) => html`<tr>
            <td><b>${h.name}</b>${h.is_personal ? html` <span class="badge">personal</span>` : ''}
              ${!h.active ? html` <span class="badge">inactive</span>` : ''}
              <div class="muted">${h.address || ''}</div></td>
            <td class="right"><button class="link" data-hedit="${h.id}">Edit</button>
              <button class="link" data-htoggle="${h.id}">${h.active ? 'Deactivate' : 'Activate'}</button></td></tr>`)}
        </tbody></table>`}
        ${editHome ? form(editHome === 'new' ? {} : state.homes.find((h) => h.id === editHome))
                   : html`<div class="actions"><button id="homeadd" class="secondary">Add home</button></div>`}
      </div>`;
  }

  function routesCard() {
    return html`
      <h2>Saved routes</h2>
      <div class="card">
        <p class="muted">Saved the first time an employee enters miles for a pair of places. Same miles both directions.</p>
        ${state.routes.length === 0 ? html`<p class="muted">No routes yet.</p>` : html`<table><tbody>
          ${state.routes.map((r) => html`<tr>
            <td>${r.a_label} ↔ ${r.b_label}</td>
            <td style="width:92px"><input data-rmiles="${r.id}" type="number" step="0.01" min="0.01" value="${r.miles}" aria-label="Miles"></td>
            <td class="right"><button class="small" data-rsave="${r.id}">Save</button>
              <button class="link" data-rdel="${r.id}">Delete</button></td></tr>`)}
        </tbody></table>`}
      </div>`;
  }

  function ratesCard() {
    return html`
      <h2>Mileage rates</h2>
      <div class="card">
        <p class="muted">The rate for a trip is the one in effect on the trip date. Signed reports keep the rate they were signed with.</p>
        <table><tbody>${state.rates.map((r) => html`<tr>
          <td>From ${fmtDate(r.effective_date)}</td>
          <td style="width:110px">${owner
            ? html`<input data-rate="${r.id}" type="number" step="0.001" min="0.001" value="${r.rate_per_mile}" aria-label="Rate per mile">`
            : rateStr(r.rate_per_mile) + '/mi'}</td>
          <td class="right">${owner ? html`<button class="small" data-ratesave="${r.id}">Save</button>
            <button class="link" data-ratedel="${r.id}">Delete</button>` : ''}</td></tr>`)}</tbody></table>
        ${owner ? html`<h3>Add a rate</h3>
        <form id="rateform" class="row">
          <div><label for="rd">Effective date</label><input id="rd" type="date" required></div>
          <div><label for="rv">Rate per mile ($)</label><input id="rv" type="number" step="0.001" min="0.001" required></div>
          <div style="align-self:end"><button type="submit">Add</button></div>
        </form>` : ''}
      </div>`;
  }

  function peopleCard() {
    if (!owner) return '';
    return html`
      <h2>People</h2>
      <div class="card">
        <table><tbody>${state.people.map((p) => html`<tr>
          <td><b>${p.full_name}</b>${p.active ? '' : html` <span class="badge">inactive</span>`}</td>
          <td><select data-prole="${p.user_id}" aria-label="Role">
            ${['employee', 'manager', 'owner'].map((r) => html`<option ${r === p.role ? 'selected' : ''}>${r}</option>`)}</select></td>
          <td class="right"><button class="link" data-ptoggle="${p.user_id}">${p.active ? 'Deactivate' : 'Reactivate'}</button></td></tr>`)}
        </tbody></table>
        <h3>Invite someone</h3>
        <form id="inviteform">
          <div class="row">
            <div><label for="ie">Email</label><input id="ie" type="email" required></div>
            <div><label for="iname">Full name</label><input id="iname"></div>
            <div><label for="ir">Role</label><select id="ir"><option>employee</option><option>manager</option><option>owner</option></select></div>
          </div>
          <div class="actions"><button type="submit">Send invite</button></div>
          <p class="muted">They sign in with this email and choose “Join my organization”.</p>
        </form>
        ${invites.length ? html`<h3>Pending invites</h3><table><tbody>${invites.map((i) => html`<tr>
          <td>${i.email}<div class="muted">${i.role} · ${fmtDateTime(i.created_at)}</div></td>
          <td class="right"><button class="link" data-idel="${i.id}">Cancel</button></td></tr>`)}</tbody></table>` : ''}
      </div>`;
  }

  function draw() {
    show(root, html`
      ${owner ? html`<div class="card"><form id="orgform" class="row">
        <div><label for="on" style="margin-top:0">Organization name</label><input id="on" value="${state.org.name}" required></div>
        <div style="align-self:end"><button type="submit" class="secondary">Rename</button></div></form></div>` : ''}
      ${homesCard()}${routesCard()}${ratesCard()}${peopleCard()}`);
    wire();
  }

  // Run a write, reload what changed, redraw.
  const act = (btn, fn, msg, reload = []) => run(async () => {
    await fn();
    for (const r of reload) await r();
    draw();
    if (msg) toast(msg);
  }, btn);
  const q = (s) => root.querySelector(s);
  const all = (s) => root.querySelectorAll(s);

  function wire() {
    const org = q('#orgform');
    if (org) org.addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      await must(db.from('orgs').update({ name: q('#on').value.trim() }).eq('id', state.org.id));
      state.org.name = q('#on').value.trim();
    }, 'Renamed'); });

    // homes
    const add = q('#homeadd'); if (add) add.addEventListener('click', () => { editHome = 'new'; draw(); });
    const cancel = q('#homecancel'); if (cancel) cancel.addEventListener('click', () => { editHome = null; draw(); });
    all('[data-hedit]').forEach((b) => b.addEventListener('click', () => { editHome = b.dataset.hedit; draw(); }));
    all('[data-htoggle]').forEach((b) => b.addEventListener('click', () => {
      const h = state.homes.find((x) => x.id === b.dataset.htoggle);
      act(b, () => must(db.from('homes').update({ active: !h.active }).eq('id', h.id)), '', [loadHomes]);
    }));
    const hf = q('#homeform');
    if (hf) hf.addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      const row = { name: q('#hn').value.trim(), address: q('#ha').value.trim() || null, is_personal: q('#hp').checked };
      if (editHome === 'new') await must(db.from('homes').insert(row));
      else await must(db.from('homes').update(row).eq('id', editHome));
      editHome = null;
    }, 'Saved', [loadHomes]); });

    // routes
    all('[data-rsave]').forEach((b) => b.addEventListener('click', () => act(b, async () => {
      const miles = Number(q(`[data-rmiles="${b.dataset.rsave}"]`).value);
      if (!(miles > 0)) throw new Error('Miles must be greater than 0');
      await must(db.from('routes').update({ miles }).eq('id', b.dataset.rsave));
    }, 'Route updated', [loadRoutes])));
    all('[data-rdel]').forEach((b) => b.addEventListener('click', () => {
      if (!confirm('Delete this saved route? Past trips are not affected.')) return;
      act(b, () => must(db.from('routes').delete().eq('id', b.dataset.rdel)), 'Route deleted', [loadRoutes]);
    }));

    // rates (owner)
    all('[data-ratesave]').forEach((b) => b.addEventListener('click', () => act(b, async () => {
      const v = Number(q(`[data-rate="${b.dataset.ratesave}"]`).value);
      if (!(v > 0)) throw new Error('Enter a rate above 0');
      await must(db.from('mileage_rates').update({ rate_per_mile: v }).eq('id', b.dataset.ratesave));
    }, 'Rate updated', [loadRates])));
    all('[data-ratedel]').forEach((b) => b.addEventListener('click', () => {
      if (!confirm('Delete this rate? Trips on dates it covers will fall back to the previous rate.')) return;
      act(b, () => must(db.from('mileage_rates').delete().eq('id', b.dataset.ratedel)), 'Rate deleted', [loadRates]);
    }));
    const rf = q('#rateform');
    if (rf) rf.addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      await must(db.from('mileage_rates').insert({ effective_date: q('#rd').value, rate_per_mile: Number(q('#rv').value) }));
    }, 'Rate added', [loadRates]); });

    // people (owner)
    all('[data-prole]').forEach((s) => s.addEventListener('change', () => act(s, () =>
      must(db.from('profiles').update({ role: s.value }).eq('user_id', s.dataset.prole)), 'Role updated', [loadPeople])
      .then(() => draw())));
    all('[data-ptoggle]').forEach((b) => b.addEventListener('click', () => {
      const p = state.people.find((x) => x.user_id === b.dataset.ptoggle);
      act(b, () => must(db.from('profiles').update({ active: !p.active }).eq('user_id', p.user_id)), '', [loadPeople]);
    }));
    const inv = q('#inviteform');
    if (inv) inv.addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => {
      await must(db.from('invites').insert({
        email: q('#ie').value.trim(), full_name: q('#iname').value.trim() || null, role: q('#ir').value,
      }));
    }, 'Invite saved. Tell them to sign in with that email.', [loadInvites]); });
    all('[data-idel]').forEach((b) => b.addEventListener('click', () =>
      act(b, () => must(db.from('invites').delete().eq('id', b.dataset.idel)), 'Invite cancelled', [loadInvites])));
  }

  await loadInvites();
  draw();
}
