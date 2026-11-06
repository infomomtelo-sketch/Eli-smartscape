import { db, configured } from './supabase.js';
import { state, loadContext, isManager } from './store.js';
import { html, show, toast, run } from './ui.js';
import { NOTICE } from './util.js';

const root = document.getElementById('app');
let lastUser = null;
let current = 0; // guards against out-of-order async renders

const TABS = [
  { id: 'log', label: 'Log trip', show: () => true },
  { id: 'report', label: 'Report', show: () => true },
  { id: 'approvals', label: 'Approvals', show: isManager },
  { id: 'setup', label: 'Setup', show: isManager },
];

function notice() {
  return html`<footer class="notice">${NOTICE}</footer>`;
}

function renderNeedsConfig() {
  show(root, html`<div class="card center"><h1>Almost there</h1>
    <p class="muted">Add the Supabase <b>anon public</b> key to <code>config.js</code>, then reload.</p></div>${notice()}`);
}

// ---- sign-in (magic link) ---------------------------------------------------
function renderLogin() {
  show(root, html`
    <div class="card center">
      <h1>Mileage Reimbursement</h1>
      <p class="muted">Enter your work email. We'll email you a sign-in link.</p>
      <form id="login">
        <label for="email">Email</label>
        <input id="email" type="email" autocomplete="email" inputmode="email" required>
        <div class="actions"><button type="submit">Email me a link</button></div>
      </form>
    </div>${notice()}`);
  root.querySelector('#login').addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    run(async () => {
      const email = root.querySelector('#email').value.trim();
      const { error } = await db.auth.signInWithOtp({
        email, options: { emailRedirectTo: location.origin + location.pathname },
      });
      if (error) throw new Error(error.message);
      show(root, html`<div class="card center"><h1>Check your email</h1>
        <p class="muted">We sent a sign-in link to <b>${email}</b>. Open it on this device.</p></div>${notice()}`);
    }, btn);
  });
}

// ---- first login: join an invited org, or create one -----------------------
function renderOnboarding() {
  show(root, html`
    <div class="card">
      <h1>Welcome</h1>
      <p class="muted">Signed in as ${state.session.user.email}.</p>
      <label for="name">Your full name</label>
      <input id="name" autocomplete="name" required>
      <h3>Were you invited by your employer?</h3>
      <div class="actions"><button id="join">Join my organization</button></div>
      <h3>Setting up for the first time?</h3>
      <label for="org">Organization name</label>
      <input id="org" placeholder="e.g. Sunrise Care Homes">
      <div class="actions"><button id="create" class="secondary">Create organization (I'll be the owner)</button></div>
      <p class="actions"><button id="out" class="link">Sign out</button></p>
    </div>${notice()}`);
  const name = () => root.querySelector('#name').value.trim();
  const after = async () => { await loadContext(); route(); };
  root.querySelector('#join').addEventListener('click', (e) => run(async () => {
    if (!name()) throw new Error('Enter your full name');
    const { error } = await db.rpc('claim_invite', { p_full_name: name() });
    if (error) throw new Error(error.message);
    await after();
  }, e.target));
  root.querySelector('#create').addEventListener('click', (e) => run(async () => {
    const org = root.querySelector('#org').value.trim();
    if (!name() || !org) throw new Error('Enter your name and the organization name');
    const { error } = await db.rpc('create_org', { p_org_name: org, p_full_name: name() });
    if (error) throw new Error(error.message);
    await after();
  }, e.target));
  root.querySelector('#out').addEventListener('click', () => db.auth.signOut());
}

// ---- shell + router ---------------------------------------------------------
async function route() {
  const token = ++current;
  if (!configured) return renderNeedsConfig();
  if (!state.session) return renderLogin();
  if (!state.profile) {
    const ok = await run(() => loadContext());
    if (token !== current || ok === undefined) return; // undefined = load failed (already toasted)
    if (!ok) return renderOnboarding();
  }
  const tabs = TABS.filter((t) => t.show());
  let id = (location.hash.match(/^#\/(\w+)/) || [])[1];
  if (!tabs.some((t) => t.id === id)) id = 'log';

  show(root, html`
    <header class="top">
      <div><h1>${state.org.name}</h1></div>
      <div class="who">${state.profile.full_name} · ${state.profile.role}
        <button class="link" id="out">Sign out</button></div>
    </header>
    <main id="view"></main>
    ${notice()}
    <nav class="tabs">${tabs.map((t) =>
      html`<a href="#/${t.id}" class="${t.id === id ? 'on' : ''}">${t.label}</a>`)}</nav>`);
  root.querySelector('#out').addEventListener('click', () => db.auth.signOut());

  const mod = await import(`./views/${id}.js`);
  if (token !== current) return;
  try {
    await mod.view(root.querySelector('#view'));
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function boot() {
  if (!configured) return renderNeedsConfig();
  const { data } = await db.auth.getSession();
  state.session = data.session;
  lastUser = data.session ? data.session.user.id : null;
  db.auth.onAuthStateChange((_evt, session) => {
    const uid = session ? session.user.id : null;
    state.session = session;
    if (uid === lastUser) return; // token refresh etc.
    lastUser = uid;
    state.profile = null; state.org = null;
    route();
  });
  window.addEventListener('hashchange', route);
  route();
}

boot();
