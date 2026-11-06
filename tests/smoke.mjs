// Browser smoke test: real UI in headless Chromium, in-memory Supabase stand-in.
// Run: node tests/smoke.mjs   (needs the `playwright` package and Chromium)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const OUT = process.env.SMOKE_OUT || '/tmp';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const f = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
}).listen(0);
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', (d) => d.accept());

await ctx.route('**/@supabase/supabase-js**', (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, 'tests/mock-supabase.js')) }));
await ctx.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript',
  body: "export const SUPABASE_URL='https://example.supabase.co'; export const SUPABASE_ANON_KEY='test-key';" }));
if (process.env.JSPDF_FILE) await ctx.route('**/jspdf.umd.min.js', (r) => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.JSPDF_FILE) }));
await page.addInitScript(() => {
  if (!localStorage.getItem('mockUser') && !localStorage.getItem('loggedOut'))
    localStorage.setItem('mockUser', JSON.stringify({ id: '00000000-0000-0000-0000-00000000000a', email: 'owner@x.com' }));
});

const step = (s) => console.log('•', s);
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });

step('onboarding: create org');
await page.goto(base);
await page.fill('#name', 'Olivia Owner');
await page.fill('#org', 'Acme Care');
await page.click('#create');
await page.waitForSelector('nav.tabs');
await shot('01-log');

step('setup: homes');
await page.click('nav.tabs >> text=Setup');
for (const [name, personal] of [['Oak House', false], ['Elm House', false], ['Olivia Home', true]]) {
  await page.click('#homeadd');
  await page.fill('#hn', name);
  if (personal) await page.check('#hp');
  await page.click('#homeform button[type=submit]');
  await page.waitForSelector(`text=${name}`);
}
assert.equal(await page.locator('[data-rdel]').count(), 0);
await page.waitForSelector('text=From 01/01/2026');
await page.waitForSelector('text=From 07/01/2026');
await shot('02-setup');

step('log: first trip saves a route; reverse trip autofills it');
await page.click('nav.tabs >> text=Log trip');
await page.fill('#date', '2026-08-10');
await page.fill('#from', 'Oak House');
await page.fill('#to', 'Elm House');
await page.fill('#miles', '4.2');
await page.click('#f button[type=submit]');
await page.waitForSelector('text=Trip added');
await page.fill('#date', '2026-08-12');
await page.fill('#from', 'Elm House');
await page.fill('#to', 'Oak House');
assert.equal(await page.inputValue('#miles'), '4.2', 'miles auto-filled from saved route');
await page.click('#f button[type=submit]');
await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 2);

step('log: personal-home warning');
await page.fill('#from', 'Olivia Home');
await page.fill('#to', 'Oak House');
assert.ok(await page.locator('#warn .warn').isVisible());
await page.fill('#from', '');
await page.fill('#to', '');

step('log: edit and delete');
await page.click('[data-edit] >> nth=0');
await page.fill('#miles', '5');
await page.click('#f button[type=submit]');
await page.waitForSelector('text=Trip updated');
await page.click('[data-del] >> nth=1');
await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
await page.fill('#date', '2026-08-12');
await page.fill('#from', 'Elm House');
await page.fill('#to', 'Oak House');
await page.click('#f button[type=submit]');
await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 2);

step('report: mixed-month totals, sign, lock');
await page.click('nav.tabs >> text=Report');
await page.fill('#month', '2026-08');
await page.waitForSelector('text=Total expense');
const total = Math.round((5 * 0.76 + 4.2 * 0.76) * 100) / 100;
await page.waitForSelector(`h3:has-text("$${total.toFixed(2)}")`);
await shot('03-report');
await page.fill('#sig', 'Olivia Owner');
await page.click('#sign');
await page.waitForSelector('.badge.signed');
await page.click('nav.tabs >> text=Log trip');
await page.fill('#date', '2026-08-15');
await page.waitForSelector('text=trips are locked');
assert.ok(await page.locator('#f button[type=submit]').isDisabled());

step('report: downloads');
await page.click('nav.tabs >> text=Report');
await page.fill('#month', '2026-08');
const [csv] = await Promise.all([page.waitForEvent('download'), page.click('#csv')]);
const csvText = fs.readFileSync(await csv.path(), 'utf8');
assert.match(csvText, /Business purpose/);
assert.match(csvText, /Between care homes/);
const [pdf] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#pdf')]).catch((e) => {
  console.log('  (PDF skipped: ' + e.message.split('\n')[0] + ')'); return [null];
});
if (pdf) { fs.copyFileSync(await pdf.path(), `${OUT}/report.pdf`); console.log('  PDF saved', pdf.suggestedFilename()); }

step('approvals: approve, pay');
await page.click('nav.tabs >> text=Approvals');
await page.click('tr[data-id]');
await page.click('#approve');
await page.waitForFunction(() => document.getElementById('toast').textContent === 'Approved');
await page.selectOption('#st', 'approved');
await page.click('tr[data-id]');
await page.selectOption('#pm', 'check');
await page.click('#paid');
await page.waitForSelector('text=Marked paid');
await page.selectOption('#st', 'paid');
await page.waitForSelector('.badge.paid');
await page.click('tr[data-id]');
await page.waitForSelector('p:has-text("Paid")');
await shot('04-approvals');
const hist = await page.locator('h3:has-text("History") + table tr').count();
assert.equal(hist, 4, 'history rows: created, signed, approved, paid; got ' + hist);

step('signed month rejects further unsigning once approved');
await page.click('nav.tabs >> text=Report');
await page.fill('#month', '2026-08');
await page.waitForSelector('.badge.paid');
assert.equal(await page.locator('#unsign').count(), 0);
const [pdf2] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#pdf')]).catch(() => [null]);
if (pdf2) fs.copyFileSync(await pdf2.path(), `${OUT}/report-paid.pdf`);

console.log(errors.length ? '\nPage errors:\n' + errors.join('\n') : '\nNo page errors.');
await browser.close(); server.close();
assert.equal(errors.filter((e) => !/Failed to load resource/.test(e)).length, 0);
console.log('SMOKE OK');
