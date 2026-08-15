// vp-sk-PR-3 — skeptic re-test: navigator.storage.persist() must be requested
// at boot (exactly once), feature-detected, with rejection swallowed.
// Instruments persist() BEFORE the page loads; also boots a second context in
// which persist() rejects, to prove the .catch(() => {}) really swallows it.
// Run: cd probes && node vp-sk-pr3-persist-count.mjs
import { chromium } from 'playwright-core';
import { startServer } from '../serve.mjs';

const srv = await startServer();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fails = 0;
const ok = (cond, label) => { console.log((cond ? 'ok   ' : 'FAIL ') + label); if (!cond) fails++; };

// A: count calls
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
  await page.addInitScript(() => {
    window.__persistCalls = 0;
    const orig = navigator.storage.persist.bind(navigator.storage);
    Object.defineProperty(navigator.storage, 'persist', {
      value: () => { window.__persistCalls++; return orig(); }
    });
  });
  await page.goto(srv.url + 'step1.html');
  await page.waitForTimeout(1200);
  const calls = await page.evaluate(() => window.__persistCalls);
  console.log('[A] persist() calls at boot:', calls);
  ok(calls === 1, '[A] persist() requested exactly once at boot');
  ok(errors.length === 0, '[A] no page exceptions');
  await context.close();
}

// B: persist() rejects — boot must survive
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'persist', {
      value: () => Promise.reject(new Error('denied by test'))
    });
  });
  await page.goto(srv.url + 'step1.html');
  await page.waitForTimeout(1200);
  const booted = await page.evaluate(() => !!document.querySelector('#lib-new'));
  ok(booted, '[B] app boots when persist() rejects');
  ok(errors.length === 0, '[B] rejection swallowed — no unhandled pageerror');
  await context.close();
}

// C: navigator.storage missing entirely — feature detection must hold
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('PAGE EXCEPTION:', e.message); });
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'storage', { get: () => undefined });
  });
  await page.goto(srv.url + 'step1.html');
  await page.waitForTimeout(1200);
  const booted = await page.evaluate(() => !!document.querySelector('#lib-new'));
  ok(booted, '[C] app boots with navigator.storage undefined (feature-detected)');
  ok(errors.length === 0, '[C] no page exceptions');
  await context.close();
}

await browser.close();
await srv.close();
console.log(fails === 0 ? 'vp-sk-PR-3 VERDICT: PASS' : `vp-sk-PR-3 VERDICT: FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
