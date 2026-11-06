// In-memory stand-in for @supabase/supabase-js, used ONLY by the browser smoke test.
// It mimics the database triggers/RPCs closely enough to exercise the UI wiring.
// The real rules are tested against Postgres in supabase/tests (see README).
const T = { orgs: [], profiles: [], invites: [], homes: [], routes: [], mileage_rates: [],
            reports: [], trips: [], audit_log: [] };
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
let auditId = 0;
const user = JSON.parse(localStorage.getItem('mockUser') || 'null');
const me = () => T.profiles.find((p) => p.user_id === user.id && p.active);
const orgId = () => (me() || {}).org_id;
const fail = (message, code) => ({ data: null, error: { message, code } });
window.__T = T; // for assertions

function audit(r, action, from, to) {
  T.audit_log.push({ id: ++auditId, org_id: r.org_id, report_id: r.id, actor_id: user.id, action,
    from_status: from, to_status: to, at: now() });
}
function rateFor(oid, d) {
  const c = T.mileage_rates.filter((x) => x.org_id === oid && x.effective_date <= d)
    .sort((a, b) => b.effective_date.localeCompare(a.effective_date));
  return c[0] ? Number(c[0].rate_per_mile) : null;
}
function price(t, r) {
  const rate = rateFor(r.org_id, t.trip_date);
  if (rate == null) throw new Error('No mileage rate is in effect on ' + t.trip_date);
  t.rate_applied = rate; t.amount = Math.round(t.miles * rate * 100 + 1e-9) / 100;
}

function beforeInsert(table, row) {
  const o = { id: uid(), created_at: now(), ...row };
  if (table !== 'orgs') o.org_id = orgId() || o.org_id;
  if (table === 'homes') { o.active = true; o.is_personal = !!o.is_personal; }
  if (table === 'routes') {
    if (o.a_key > o.b_key) [o.a_key, o.b_key, o.a_label, o.b_label] = [o.b_key, o.a_key, o.b_label, o.a_label];
    if (T.routes.some((r) => r.org_id === o.org_id && r.a_key === o.a_key && r.b_key === o.b_key)) {
      const e = new Error('duplicate key value'); e.code = '23505'; throw e;
    }
  }
  if (table === 'reports') {
    o.user_id = user.id; o.status = 'draft'; o.snapshot = null;
    if (T.reports.some((r) => r.user_id === o.user_id && r.month === o.month)) throw new Error('duplicate report');
  }
  if (table === 'trips') {
    const r = T.reports.find((x) => x.id === o.report_id);
    if (!r || r.status !== 'draft') throw new Error('This month is ' + (r && r.status) + ' and its trips are locked');
    o.org_id = r.org_id; o.user_id = r.user_id; price(o, r);
  }
  if (table === 'invites') o.email = o.email.toLowerCase();
  return o;
}
function afterInsert(table, o) { if (table === 'reports') audit(o, 'created', null, 'draft'); }

class Q {
  constructor(t) { this.t = t; this.op = 'select'; this.f = []; this.ord = []; this.one = null; this.ret = false; }
  select() { this.ret = true; return this; }
  insert(p) { this.op = 'insert'; this.p = p; return this; }
  update(p) { this.op = 'update'; this.p = p; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.f.push((r) => r[c] === v); return this; }
  neq(c, v) { this.f.push((r) => r[c] !== v); return this; }
  is(c, v) { this.f.push((r) => (r[c] ?? null) === v); return this; }
  order(c, o = {}) { this.ord.push([c, o.ascending !== false]); return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  single() { this.one = 'one'; return this; }
  then(a, b) { return this.exec().then(a, b); }
  async exec() {
    try {
      let rows = T[this.t];
      const oid = orgId();
      const visible = (r) => this.t === 'orgs' ? r.id === oid : r.org_id === oid;
      let out;
      if (this.op === 'insert') {
        out = (Array.isArray(this.p) ? this.p : [this.p]).map((r) => {
          const o = beforeInsert(this.t, r); T[this.t].push(o); afterInsert(this.t, o); return o;
        });
      } else {
        rows = rows.filter(visible).filter((r) => this.f.every((f) => f(r)));
        if (this.op === 'update') {
          rows.forEach((r) => { Object.assign(r, this.p); if (this.t === 'trips') price(r, T.reports.find((x) => x.id === r.report_id)); });
          out = rows;
        } else if (this.op === 'delete') {
          if (this.t === 'trips') rows.forEach((r) => { if (T.reports.find((x) => x.id === r.report_id).status !== 'draft') throw new Error('locked'); });
          T[this.t] = T[this.t].filter((r) => !rows.includes(r)); out = rows;
        } else {
          out = [...rows];
          for (const [c, asc] of [...this.ord].reverse()) out.sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
        }
      }
      if (this.one === 'maybe') return { data: out[0] || null, error: null };
      if (this.one === 'one') return out[0] ? { data: out[0], error: null } : fail('No rows');
      return { data: out, error: null };
    } catch (e) { return fail(e.message, e.code); }
  }
}

const rpcs = {
  create_org({ p_org_name, p_full_name }) {
    if (me()) throw new Error('You already belong to an organization');
    const o = { id: uid(), name: p_org_name, created_at: now() }; T.orgs.push(o);
    T.profiles.push({ user_id: user.id, org_id: o.id, full_name: p_full_name, role: 'owner', active: true });
    T.mileage_rates.push({ id: uid(), org_id: o.id, effective_date: '2026-01-01', rate_per_mile: 0.725 },
                         { id: uid(), org_id: o.id, effective_date: '2026-07-01', rate_per_mile: 0.76 });
  },
  claim_invite() { throw new Error('No invitation found for this email'); },
  sign_report({ p_report, p_name }) {
    const r = T.reports.find((x) => x.id === p_report);
    if (r.status !== 'draft') throw new Error('Report is already ' + r.status);
    const ts = T.trips.filter((t) => t.report_id === r.id);
    ts.forEach((t) => price(t, r));
    r.snapshot = { employee_name: me().full_name, month: r.month, signed_name: p_name, signed_at: now(),
      trips: ts.map((t) => ({ date: t.trip_date, from: t.from_label, to: t.to_label, purpose: t.purpose,
        miles: t.miles, rate: t.rate_applied, amount: t.amount })) };
    r.snapshot_hash = 'a'.repeat(64); r.signed_name = p_name; r.signed_at = r.snapshot.signed_at;
    r.status = 'signed'; audit(r, 'signed', 'draft', 'signed');
  },
  unsign_report({ p_report }) {
    const r = T.reports.find((x) => x.id === p_report);
    if (r.status !== 'signed') throw new Error('Only a signed, not-yet-approved report can be unsigned');
    Object.assign(r, { status: 'draft', signed_name: null, signed_at: null, snapshot: null, snapshot_hash: null });
    audit(r, 'unsigned', 'signed', 'draft');
  },
  approve_report({ p_report }) {
    const r = T.reports.find((x) => x.id === p_report);
    if (r.status !== 'signed') throw new Error('Only a signed report can be approved');
    Object.assign(r, { status: 'approved', approved_by: user.id, approved_at: now() }); audit(r, 'approved', 'signed', 'approved');
  },
  mark_paid({ p_report, p_paid_date, p_method }) {
    const r = T.reports.find((x) => x.id === p_report);
    if (r.status !== 'approved') throw new Error('Only an approved report can be marked paid');
    Object.assign(r, { status: 'paid', paid_date: p_paid_date, payment_method: p_method }); audit(r, 'paid', 'approved', 'paid');
  },
};

export function createClient() {
  const listeners = [];
  return {
    from: (t) => new Q(t),
    rpc: async (name, args) => { try { rpcs[name](args || {}); return { data: null, error: null }; } catch (e) { return fail(e.message); } },
    auth: {
      getSession: async () => ({ data: { session: user ? { user: { id: user.id, email: user.email } } : null } }),
      onAuthStateChange: (cb) => { listeners.push(cb); return { data: { subscription: {} } }; },
      signInWithOtp: async () => ({ error: null }),
      signOut: async () => { localStorage.removeItem('mockUser'); location.reload(); return {}; },
    },
  };
}
