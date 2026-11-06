// Tiny safe-HTML helpers. Everything interpolated is escaped unless wrapped in raw()
// or produced by html`` itself, so user-typed labels cannot inject markup.
const RAW = Symbol('raw');
export const raw = (s) => ({ [RAW]: true, s: String(s) });

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

function val(v) {
  if (v == null || v === false) return '';
  if (Array.isArray(v)) return v.map(val).join('');
  if (typeof v === 'object' && v[RAW]) return v.s;
  return esc(v);
}
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += val(vals[i]); });
  return raw(out);
}
export function show(el, h) { el.innerHTML = h.s; }

let toastTimer;
export function toast(msg, kind = 'ok') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, kind === 'err' ? 6000 : 2500);
}

// Run an async action; show any error as a toast; disable the button meanwhile.
export async function run(fn, btn) {
  try {
    if (btn) btn.disabled = true;
    return await fn();
  } catch (e) {
    toast(e.message || String(e), 'err');
  } finally {
    if (btn) btn.disabled = false;
  }
}
